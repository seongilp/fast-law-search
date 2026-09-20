#!/usr/bin/env bash
# 원본 법령 레포를 당겨오고 + 행정규칙을 수집한 뒤 무중단(alias) 재색인하고
# 결과를 텔레그램으로 알린다. flock 으로 동시 실행을 막는다.
#
# 컬렉션 2개를 색인한다:
#   kr_laws       ← corpus(legalize-kr/legalize-kr) 의 법령·행정규칙
#   kr_precedents ← fast-law-search(seongilp) 의 판례 데이터(prec/)
# 판례 데이터·코드는 fast-law-search 한 repo 에 있고 GitHub Actions 가 수집·push 한다.
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
  # Discord 먼저 — 아래 텔레그램 분기는 설정 파일이 없으면 return 한다.
  /usr/local/bin/notify-discord.sh "$1" 2>/dev/null || true
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

# 0) Typesense 헬스 체크 + 자가 복구
#    파일 디스크립터 고갈(EMFILE) 등으로 raft 노드가 ERROR 로 빠지면 스스로 못 빠져나온다
#    (--reset-peers-on-error 가 있어도 "can't reset_peer"). 컨테이너를 재시작하면
#    스냅샷에서 복구되므로 색인 전에 확인하고 필요하면 재시작한다.
#    2026-09-17 에 이 상태로 나흘간 매일 밤 색인이 503 으로 실패했다.
wait_healthy() {
  local tries=$1
  for _ in $(seq 1 "$tries"); do
    if [ "$(curl -s --max-time 10 http://localhost:8108/health)" = '{"ok":true}' ]; then
      return 0
    fi
    sleep 15
  done
  return 1
}

if ! wait_healthy 4; then
  echo "[warn] Typesense 비정상 — 컨테이너 재시작 후 복구 대기" >>"$LOG"
  tg "⚠️ Typesense 비정상 — 자동 재시작 시도
$(NOW)"
  docker compose -f /opt/legalize/docker-compose.yml restart >>"$LOG" 2>&1
  if ! wait_healthy 40; then
    echo "[error] 재시작 후에도 Typesense 가 준비되지 않음" >>"$LOG"
    fail
  fi
  echo "[info] Typesense 자동 복구 성공" >>"$LOG"
fi

# 1) 원본 법령 레포 동기화 (corpus/kr = 법률·시행령·시행규칙 등)
#    업스트림(legalize-kr)은 법 개정일을 커밋 날짜로 삼아 히스토리를 통째로 재생성·force-push 한다.
#    그때마다 로컬과 히스토리가 분기해 `pull --ff-only` 가 영구히 실패하므로(2026-07-20 장애),
#    fetch + reset --hard 로 업스트림을 항상 정본으로 삼는다.
#    corpus 는 읽기 전용 미러이고, 우리가 수집한 행정규칙은 untracked 라 reset 대상이 아니다.
if [ -d corpus/.git ]; then
  git -C corpus fetch --depth 1 origin main >>"$LOG" 2>&1 || fail
  git -C corpus reset --hard FETCH_HEAD >>"$LOG" 2>&1 || fail
else
  git clone --depth 1 https://github.com/legalize-kr/legalize-kr.git corpus >>"$LOG" 2>&1 || fail
fi

# 1.5) 행정규칙 수집 (corpus/kr 에 추가). 실패해도 색인은 계속한다.
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

# 2) 법령 무중단 재색인 (index.py 가 alias 전환 + 구컬렉션 정리까지 수행)
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

# 법령 결과는 판례 색인 전에 먼저 캡처한다(이후 [done]/[alias] 마커가 판례 것으로 덮임).
DOCS=$(grep -E '\[done\]' "$LOG" | tail -1 | grep -oE '조문 도큐먼트 [0-9]+' | grep -oE '[0-9]+' || echo "?")
ALIAS_LINE=$(grep -E '\[alias\]' "$LOG" | tail -1 | tr -d '\r')

# 2.5) 판례 무중단 재색인 (fast-law-search 의 prec/ → kr_precedents)
#      데이터·인덱서 코드를 fast-law-search 에서 받는다.
FLS=/opt/legalize/fls
if [ -d "$FLS/.git" ]; then
  git -C "$FLS" pull --ff-only >>"$LOG" 2>&1 || echo "[warn] fast-law-search pull 실패" >>"$LOG"
else
  git clone --depth 1 https://github.com/seongilp/fast-law-search.git "$FLS" >>"$LOG" 2>&1 \
    || echo "[warn] fast-law-search clone 실패" >>"$LOG"
fi

# RAM 가드: 법령+판례 동시 로드 ~1.8GiB(+alias 중 스파이크). 4GB 미만 머신에선
# OOM 위험이 커서 판례 색인을 건너뛴다. 메모리 증설 후 자동으로 활성화된다.
MEM_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
PREC_DOCS="-"
if [ -d "$FLS/prec" ] && [ "${MEM_KB:-0}" -ge 3500000 ]; then
  do_index_prec() {
    TYPESENSE_HOST=localhost TYPESENSE_PORT=8108 TYPESENSE_PROTOCOL=http \
      TYPESENSE_API_KEY="$AK" PREC_COLLECTION=kr_precedents \
      PREC_ROOT="$FLS/prec" \
      .venv/bin/python "$FLS/indexer/index_prec.py" --alias >>"$LOG" 2>&1 \
      && grep -q "alias.*kr_precedents" "$LOG"
  }
  if do_index_prec; then
    PREC_DOCS=$(grep -E '\[done\] 파일' "$LOG" | tail -1 | grep -oE '인덱싱 성공 [0-9]+' | grep -oE '[0-9]+' || echo "?")
  else
    echo "[warn] 판례 색인 실패" >>"$LOG"
    tg "⚠️ 판례 색인 실패
$(NOW)"
  fi
elif [ -d "$FLS/prec" ]; then
  echo "[warn] RAM 부족(${MEM_KB}KB < 3.5GB) — 판례 색인 건너뜀(증설 후 자동 활성)" >>"$LOG"
  PREC_DOCS="skip(RAM)"
fi

tg "✅ 법령·행정규칙·판례 색인 완료
$(NOW)
조문 ${DOCS}건 / 판례 ${PREC_DOCS}건
${ALIAS_LINE}
🔎 https://law.zihado.com"

rm -f "$LOG"
