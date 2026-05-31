"""Typesense 컬렉션 스키마 정의. 한국어는 locale 'ko' 토크나이저 사용."""
from __future__ import annotations


def collection_schema(name: str) -> dict:
    return {
        "name": name,
        # 기본 정렬/관련도 보조 필드
        "default_sorting_field": "article_seq",
        # Typesense 는 단일바이트(ASCII) 구분자만 허용한다. 한글 가운뎃점(ㆍ·)
        # 등 멀티바이트 분리는 locale:"ko" 토크나이저가 처리하므로 여기선 ASCII만.
        "token_separators": ["/", "(", ")", "[", "]"],
        "fields": [
            # 검색 대상(한국어)
            {"name": "content", "type": "string", "locale": "ko"},
            {"name": "article_title", "type": "string", "locale": "ko", "optional": True},
            {"name": "law_name", "type": "string", "locale": "ko", "facet": True},
            {"name": "chapter", "type": "string", "locale": "ko", "optional": True},
            # 필터/패싯
            {"name": "law_type", "type": "string", "facet": True},
            {"name": "ministry", "type": "string[]", "facet": True, "optional": True},
            {"name": "status", "type": "string", "facet": True, "optional": True},
            {"name": "article_label", "type": "string", "optional": True},
            # 정렬/범위
            {"name": "article_no", "type": "int32"},
            {"name": "article_seq", "type": "int32"},
            {"name": "promulgation_date", "type": "int32", "optional": True},
            {"name": "enforcement_date", "type": "int32", "optional": True},
            # 메타(검색X, 표시/링크용)
            {"name": "law_dir", "type": "string", "index": False, "optional": True},
            {"name": "mst", "type": "string", "index": False, "optional": True},
            {"name": "source_url", "type": "string", "index": False, "optional": True},
            {"name": "file_path", "type": "string", "index": False, "optional": True},
        ],
    }
