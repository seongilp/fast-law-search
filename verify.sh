#!/usr/bin/env bash
# 인덱스 상태 + 샘플 검색을 한 번에 확인하는 헬퍼.
#   cd search && ./verify.sh "개인정보 동의"
set -euo pipefail
cd "$(dirname "$0")"

KEY=$(grep '^TYPESENSE_API_KEY=' .env 2>/dev/null | cut -d= -f2)
KEY=${KEY:-legalize_dev_key}
HOST=${TYPESENSE_HOST:-localhost}
PORT=${TYPESENSE_PORT:-8108}
COLL=${TYPESENSE_COLLECTION:-kr_laws}
Q="${1:-개인정보 동의}"

echo "== Typesense health =="
curl -s "http://$HOST:$PORT/health"; echo

echo "== 컬렉션: $COLL =="
curl -s "http://$HOST:$PORT/collections/$COLL" -H "X-TYPESENSE-API-KEY: $KEY" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('  인덱싱된 조문 수:',d.get('num_documents'));print('  필드 수:',len(d.get('fields',[])))"

echo "== 샘플 검색: '$Q' =="
curl -s -G "http://$HOST:$PORT/collections/$COLL/documents/search" \
  -H "X-TYPESENSE-API-KEY: $KEY" \
  --data-urlencode "q=$Q" \
  --data-urlencode "query_by=content,article_title,law_name" \
  --data-urlencode "per_page=5" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  결과:',d.get('found'),'건  /  응답:',d.get('search_time_ms'),'ms')
for h in d.get('hits',[])[:5]:
    doc=h['document']
    print('   -',doc.get('law_name'),doc.get('article_label',''),'|',(doc.get('article_title') or '')[:30])
"
