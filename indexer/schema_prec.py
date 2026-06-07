"""판례 Typesense 컬렉션 스키마. 한국어 locale 'ko' 토크나이저 사용."""
from __future__ import annotations


def collection_schema(name: str) -> dict:
    return {
        "name": name,
        "default_sorting_field": "decided_date",
        "token_separators": ["/", "(", ")", "[", "]", ",", "."],
        "fields": [
            # 검색 대상(한국어)
            {"name": "case_name", "type": "string", "locale": "ko"},
            {"name": "holding", "type": "string", "locale": "ko", "optional": True},
            {"name": "summary", "type": "string", "locale": "ko", "optional": True},
            {"name": "body", "type": "string", "locale": "ko", "optional": True},
            {"name": "refs_article", "type": "string", "locale": "ko", "optional": True},
            # 필터/패싯
            {"name": "court", "type": "string", "facet": True, "optional": True},
            {"name": "case_type", "type": "string", "facet": True, "optional": True},
            {"name": "judgment_type", "type": "string", "facet": True, "optional": True},
            {"name": "decided_year", "type": "string", "facet": True, "optional": True},
            # 정렬/범위
            {"name": "decided_date", "type": "int64"},
            # 사건번호: 검색 대상이므로 ko 토크나이저로 통일한다.
            # (다른 검색필드가 locale:ko 라 쿼리도 ko 로 쪼개지는데, case_no 가
            #  locale 없이 통째 토큰이면 "2025도6707" 검색이 어긋난다.)
            {"name": "case_no", "type": "string", "locale": "ko", "optional": True},
            {"name": "serial", "type": "string", "index": False, "optional": True},
            {"name": "source_url", "type": "string", "index": False, "optional": True},
            {"name": "file_path", "type": "string", "index": False, "optional": True},
        ],
    }
