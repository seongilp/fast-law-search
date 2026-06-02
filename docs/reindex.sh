#!/usr/bin/env bash
# 원본 법령 레포를 당겨오고 + 행정규칙을 수집한 뒤 무중단(alias) 재색인하고
# 결과를 텔레그램으로 알린다. flock 으로 동시 실행을 막는다.
set -uo pipefail
cd /opt/legalize

# --- 동시 실행 방지: 락 못 잡으면 조용히 종료 ---
exec 9>/opt/legalize/.reindex.lock
if ! flock -n 9; then
  echo "another reindex is running; skip"
  exit 0
fi

LOG=$(mktemp)
NOW() { TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST'; }

tg() {
  [ -f /opt/legalize/.telegram ] || return 0
  # shellcheck disable=SC1091
  set -a; . /opt/legalize/.telegram; set +a
  curl -s --max-time 20 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=$1" \
    -d disable_web_page_preview=true >/dev/null || true
}

fail() {
  local tail_log
  tail_log=$(tail -4 "$LOG" 2>/dev/null | tr -d '\r')
  tg "❌ 법령 색인 실패
$(NOW)
${tail_log}"
  rm -f "$LOG"
  exit 1
}

# 1) 원본 법령 레포 동기화 (corpus/kr = 법률·시행령·시행규칙 등)
if [ -d corpus/.git ]; then
  git -C corpus pull --ff-only >>"$LOG" 2>&1 || fail
else
  git clone --depth 1 https://github.com/legalize-kr/legalize-kr.git corpus >>"$LOG" 2>&1 || fail
fi

# 1.5) 행정규칙 수집 (corpus/kr 에 추가). 실패해도 색인은 계속한다
#      (기존 수집분이 corpus/kr 에 남아 있으므로 그 위에 색인됨).
#      resume: 일련번호(법령MST) 동일하면 본문 조회 없이 스킵 → 변경분만 갱신.
if [ -f /opt/legalize/.lawoc ]; then
  LAW_GO_KR_OC=$(cat /opt/legalize/.lawoc) \
  ADMRULE_ROOT=/opt/legalize/corpus/kr \
  COLLECT_CONCURRENCY=6 COLLECT_RETRY=3 \
  PYTHONPATH=/opt/legalize \
    .venv/bin/python -m collector.fetch >>"$LOG" 2>&1 \
    || echo "[warn] 행정규칙 수집 일부 실패 — 기존 수집분으로 색인 계속" >>"$LOG"
else
  echo "[warn] /opt/legalize/.lawoc 없음 — 행정규칙 수집 건너뜀" >>"$LOG"
fi

# 2) 무중단 재색인 (index.py 가 alias 전환 + 구컬렉션 정리까지 수행)
#    corpus/kr 한 루트에 법령 + 행정규칙이 함께 있으므로 통합 색인된다.
#    일시적 실패(네트워크/일시 부하)에 대비해 1회 자동 재시도한다.
#    성공 판정은 최종 마커 [alias] (alias 전환 완료) 기준.
AK=$(cat /opt/legalize/.adminkey)
do_index() {
  TYPESENSE_HOST=localhost TYPESENSE_PORT=8108 TYPESENSE_PROTOCOL=http \
    TYPESENSE_API_KEY="$AK" TYPESENSE_COLLECTION=kr_laws \
    LAW_ROOT=/opt/legalize/corpus/kr \
    .venv/bin/python indexer/index.py --alias >>"$LOG" 2>&1 \
    && grep -q '\[alias\]' "$LOG"
}

if ! do_index; then
  echo "[warn] 색인 1차 실패 — 120초 후 재시도" >>"$LOG"
  tg "⚠️ 법령 색인 1차 실패 → 재시도
$(NOW)"
  sleep 120
  do_index || fail
fi

DOCS=$(grep -E '\[done\]' "$LOG" | tail -1 | grep -oE '조문 도큐먼트 [0-9]+' | grep -oE '[0-9]+' || echo "?")
ALIAS_LINE=$(grep -E '\[alias\]' "$LOG" | tail -1 | tr -d '\r')

tg "✅ 법령·행정규칙 색인 완료
$(NOW)
조문 ${DOCS}건 인덱싱
${ALIAS_LINE}
🔎 https://law.zihado.com"

rm -f "$LOG"
