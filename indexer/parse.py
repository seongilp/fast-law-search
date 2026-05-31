"""법령 마크다운(.md) 1개를 frontmatter + 조문 도큐먼트 리스트로 파싱한다.

입력 포맷(관찰된 구조):
    ---
    제목: ...
    법령구분: 법률
    소관부처: [ ... ]
    공포일자: 2015-10-20
    시행일자: 2015-10-20
    상태: 시행
    법령MST: 175696
    출처: https://...
    ---
    # 법령명
    ## 제1편 총칙
    ### 제1장 통칙
    ##### 제1조 (목적)
    ...본문...
    ##### 제1조의2 (...)
    ...

설계 원칙: 입력은 신뢰하지 않는다(frontmatter 누락/형식 오류 허용),
순수 함수로 (메타, [조문]) 를 반환한다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

# 조문 헤더:  "##### 제15조의2 (제목)"  /  "##### 제5조 삭제"  /  "##### 제3조"
_ARTICLE_RE = re.compile(r"^#{1,6}\s*(제(\d+)조(?:의(\d+))?)\s*(?:\((.*?)\))?\s*(.*)$")
# 구조 헤더(편/장/절/관) 및 부칙
_STRUCT_RE = re.compile(r"^#{1,6}\s*(제\d+편|제\d+장|제\d+절|제\d+관|부칙)\b.*$")
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


@dataclass(frozen=True)
class Article:
    article_label: str          # "제15조의2"
    article_no: int             # 15
    article_branch: int         # 2 (의2), 없으면 0
    article_seq: int            # 정렬용: no*1000 + branch
    article_title: str          # "개인정보의 수집·이용" (없으면 "")
    content: str                # 조문 본문(헤더 텍스트 포함)
    chapter: str                # 가장 가까운 편/장/절/관 컨텍스트


def _to_int_date(value) -> int:
    """'2015-10-20' / '20151020' / date → 20151020 정수. 실패 시 0."""
    if value is None:
        return 0
    s = str(value).strip().replace("-", "").replace(".", "").replace("/", "")
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) >= 8:
        try:
            return int(digits[:8])
        except ValueError:
            return 0
    return 0


def _normalize_ministry(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value).strip()] if str(value).strip() else []


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """선두 YAML frontmatter를 분리해 (dict, 본문) 반환. 없으면 ({}, 원문)."""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    raw = m.group(1)
    try:
        data = yaml.safe_load(raw) or {}
        if not isinstance(data, dict):
            data = {}
    except yaml.YAMLError:
        data = {}
    return data, text[m.end():]


def _split_articles(body: str) -> list[Article]:
    """본문을 조문 단위로 분할. 구조 헤더(편/장/절)는 컨텍스트로 추적."""
    lines = body.splitlines()
    articles: list[Article] = []
    chapter = ""

    cur: Optional[dict] = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal cur, buf
        if cur is None:
            return
        content = "\n".join(buf).strip()
        no = cur["no"]
        branch = cur["branch"]
        articles.append(
            Article(
                article_label=cur["label"],
                article_no=no,
                article_branch=branch,
                article_seq=no * 1000 + branch,
                article_title=cur["title"],
                content=content,
                chapter=cur["chapter"],
            )
        )
        cur, buf = None, []

    for line in lines:
        struct = _STRUCT_RE.match(line)
        art = _ARTICLE_RE.match(line)
        # 구조 헤더가 조문 헤더보다 우선(편/장/절/관/부칙은 '제N조'를 포함하지 않음)
        if struct and not art:
            flush()
            chapter = struct.group(1)
            continue
        if art:
            flush()
            label = art.group(1)
            no = int(art.group(2))
            branch = int(art.group(3)) if art.group(3) else 0
            title = (art.group(4) or "").strip()
            trailing = (art.group(5) or "").strip()  # "삭제" 등 괄호 없는 경우
            if not title and trailing:
                title = trailing
            cur = {
                "label": label,
                "no": no,
                "branch": branch,
                "title": title,
                "chapter": chapter,
            }
            buf = [line.lstrip("#").strip()]
            continue
        if cur is not None:
            buf.append(line)
        # cur 가 None 이면(첫 조문 이전 서문) 무시

    flush()
    return articles


def parse_file(path: Path, law_root: Path) -> tuple[dict, list[Article]]:
    """파일 1개 → (메타 dict, 조문 리스트). 읽기 실패는 예외로 전파."""
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)

    rel = path.relative_to(law_root)
    # kr/{법령디렉터리}/{구분}.md
    dir_name = rel.parts[0] if len(rel.parts) >= 1 else path.stem
    file_stem = path.stem

    law_name = str(meta.get("제목") or dir_name).strip()
    # 법령구분: frontmatter 우선, 없으면 파일명에서 추정
    law_type = str(meta.get("법령구분") or "").strip()
    if not law_type:
        law_type = file_stem if file_stem != dir_name else "법률"

    base_meta = {
        "law_name": law_name,
        "law_dir": dir_name,
        "law_type": law_type,
        "ministry": _normalize_ministry(meta.get("소관부처")),
        "promulgation_date": _to_int_date(meta.get("공포일자")),
        "enforcement_date": _to_int_date(meta.get("시행일자")),
        "status": str(meta.get("상태") or "").strip(),
        "mst": str(meta.get("법령MST") or "").strip(),
        "source_url": str(meta.get("출처") or "").strip(),
        "file_path": str(rel),
    }
    return base_meta, _split_articles(body)
