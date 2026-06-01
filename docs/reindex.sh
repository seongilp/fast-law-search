#!/usr/bin/env bash
# 원본 법령 레포를 당겨와 무중단(alias) 재색인하고 결과를 텔레그램으로 알린다.
# flock 으로 동시 실행을 막는다(중복 실행 시 alias/cleanup 충돌 방지).
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

# 1) 원본 레포 동기화
if [ -d corpus/.git ]; then
  git -C corpus pull --ff-only >>"$LOG" 2>&1 || fail
else
  git clone --depth 1 https://github.com/legalize-kr/legalize-kr.git corpus >>"$LOG" 2>&1 || fail
fi

# 2) 무중단 재색인 (index.py 가 alias 전환 + 구컬렉션 정리까지 수행)
AK=$(cat /opt/legalize/.adminkey)
TYPESENSE_HOST=localhost TYPESENSE_PORT=8108 TYPESENSE_PROTOCOL=http \
  TYPESENSE_API_KEY="$AK" TYPESENSE_COLLECTION=kr_laws \
  LAW_ROOT=/opt/legalize/corpus/kr \
  .venv/bin/python indexer/index.py --alias >>"$LOG" 2>&1 || fail

# 3) 성공 판정: [done] 라인이 있어야 진짜 성공
if ! grep -q '\[done\]' "$LOG"; then
  fail
fi

DOCS=$(grep -E '\[done\]' "$LOG" | tail -1 | grep -oE '조문 도큐먼트 [0-9]+' | grep -oE '[0-9]+' || echo "?")
ALIAS_LINE=$(grep -E '\[alias\]' "$LOG" | tail -1 | tr -d '\r')

tg "✅ 법령 색인 완료
$(NOW)
조문 ${DOCS}건 인덱싱
${ALIAS_LINE}
🔎 https://law.zihado.com"

rm -f "$LOG"
