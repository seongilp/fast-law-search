#!/usr/bin/env bash
# 매일 08:00 KST 색인 상태 점검 리포트를 텔레그램으로 보낸다.
# 운영 파일(레포 미포함). 참고용 사본: fast-law-search 의 docs/index_health.sh
# 자격: /opt/legalize/.telegram-health (chmod 600, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)
set -uo pipefail
cd /opt/legalize

AK=$(cat /opt/legalize/.adminkey 2>/dev/null || echo "")
export AK TS="http://localhost:8108" NOW="$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')"

tg() {
  [ -f /opt/legalize/.telegram-health ] || { echo "no .telegram-health"; return 0; }
  set -a; . /opt/legalize/.telegram-health; set +a
  curl -s --max-time 20 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=$1" \
    -d disable_web_page_preview=true >/dev/null || true
}

# --- Typesense 본문(엔진/컬렉션/별칭/샘플검색)은 파이썬으로 모은다 ---
BODY=$(python3 - <<'PY'
import os, json, time, urllib.request, urllib.parse

AK=os.environ.get("AK",""); TS=os.environ["TS"]; NOW=os.environ["NOW"]
def get(path, params=None, timeout=15):
    url=TS+path
    if params: url+="?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url, headers={"X-TYPESENSE-API-KEY":AK})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)
def kst(ts):  # epoch(UTC) -> KST 표시
    return time.strftime('%m-%d %H:%M', time.gmtime(int(ts)+9*3600)) if ts else "?"

warn=[]; lines=[]

# 엔진 health
try:
    ok=get("/health").get("ok")
    lines.append(f"엔진: {'🟢 정상' if ok else '🔴 비정상'}")
    if not ok: warn.append("health")
except Exception as e:
    lines.append(f"엔진: 🔴 응답없음 ({type(e).__name__})"); warn.append("health")

# 별칭 맵
try:
    al={a['name']:a['collection_name'] for a in get('/aliases').get('aliases',[])}
except Exception:
    al={}

# 어제(직전 실행) 건수 불러오기 → 증감 계산용
STATE="/opt/legalize/.index_health.state"
try:
    with open(STATE) as f: prev=json.load(f)
except Exception:
    prev={}
def diff(c, n):  # 어제 대비 증감 문자열
    p=prev.get(c)
    if not isinstance(p,int): return ""   # 첫 실행 등 기준값 없음
    d=n-p
    sign='+' if d>0 else ('±' if d==0 else '')
    return f" ({sign}{d:,})"

# 컬렉션 점검 (하한 임계치 미만이면 경고)
THRESH={'kr_laws':400000,'kr_precedents':50000}
NAMES={'kr_laws':'법령·행정규칙','kr_precedents':'판례'}
last_reindex=[]; cur={k:v for k,v in prev.items() if isinstance(v,int)}
for c in ('kr_laws','kr_precedents'):
    try:
        d=get(f"/collections/{c}")
        n=d.get('num_documents',0); created=d.get('created_at',0)
        cur[c]=n
        low=n<THRESH[c]
        if low: warn.append(c)
        if c not in al: warn.append(c+":alias")
        flag=(' ⚠️' if low else '')+('' if c in al else ' ⚠️alias없음')
        lines.append(f"{NAMES[c]}: {n:,}건{diff(c,n)}{flag}")
        last_reindex.append(f"{NAMES[c]} {kst(created)}")
    except Exception:
        lines.append(f"{NAMES[c]}: 🔴 조회실패"); warn.append(c)

# 오늘 건수 저장(다음 실행의 '어제' 기준). 조회 실패분은 기존값 유지.
try:
    cur['ts']=NOW
    with open(STATE,'w') as f: json.dump(cur,f,ensure_ascii=False)
except Exception:
    pass

# 샘플 검색
try:
    s=get("/collections/kr_laws/documents/search",
          {"q":"개인정보","query_by":"content,article_title,law_name","per_page":1})
    found=s.get('found',0); ms=s.get('search_time_ms','?')
    lines.append(f"샘플검색('개인정보'): {found:,}건 / {ms}ms")
    if not found: warn.append("search")
except Exception:
    lines.append("샘플검색: 🔴 실패"); warn.append("search")

if last_reindex:
    lines.append("최근 색인: "+" · ".join(last_reindex))

head = ("⚠️ 색인 점검 — 확인필요" if warn else "✅ 색인 상태 정상")
out = [head, NOW, ""] + lines
if warn:
    out += ["", "경고: "+", ".join(warn)]
print("\n".join(out))
PY
)

# --- 외부 엔드포인트(터널/엣지) + 시스템 자원은 bash 로 덧붙인다 ---
API_HEALTH=$(curl -s --max-time 10 https://api-law.zihado.com/health 2>/dev/null || echo "")
if echo "$API_HEALTH" | grep -q '"ok":true'; then
  EDGE="외부(api-law): 🟢"
else
  EDGE="외부(api-law): 🔴 (${API_HEALTH:-no response})"
fi

DISK=$(df -h / | awk 'NR==2{print $3"/"$2" ("$5")"}')
MEM=$(free -m | awk '/Mem:/{printf "%d/%dMB(%d%%)", $3,$2,$3*100/$2}')

# 마지막 재색인 cron 로그 시각(있으면)
if [ -f /opt/legalize/reindex.log ]; then
  RLOG="재색인로그: $(TZ=Asia/Seoul date -r /opt/legalize/reindex.log '+%m-%d %H:%M' 2>/dev/null || stat -c '%y' /opt/legalize/reindex.log | cut -d. -f1)"
else
  RLOG=""
fi

MSG="${BODY}

${EDGE}
디스크: ${DISK} / 메모리: ${MEM}
${RLOG}
🔎 https://law.zihado.com"

echo "$MSG"
tg "$MSG"
