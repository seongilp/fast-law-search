"""판례 마크다운(.md) 1개를 검색 도큐먼트(dict) 1개로 파싱한다.

법령 parse.py 와 달리 조문 분할을 하지 않는다(판례 1건 = 도큐먼트 1개).
섹션(## 판시사항/## 판결요지/## 참조조문/## 참조판례/## 판례내용)을 분리한다.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        data = yaml.safe_load(m.group(1)) or {}
        if not isinstance(data, dict):
            data = {}
    except yaml.YAMLError:
        data = {}
    return data, text[m.end():]


def _to_int_date(value) -> int:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) >= 8:
        try:
            return int(digits[:8])
        except ValueError:
            return 0
    return 0


def _sections(body: str) -> dict[str, str]:
    """## 헤더 기준으로 섹션 분리 → {제목: 본문}."""
    out: dict[str, str] = {}
    matches = list(_SECTION_RE.finditer(body))
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out[title] = body[start:end].strip()
    return out


def _join_refs(value) -> str:
    if isinstance(value, list):
        return " / ".join(str(v).strip() for v in value if str(v).strip())
    return str(value or "").strip()


def parse_file(path: Path, prec_root: Path) -> dict:
    """파일 1개 → 검색 도큐먼트 dict. 읽기 실패는 예외로 전파."""
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    sec = _sections(body)

    decided = _to_int_date(meta.get("선고일자"))
    rel = path.relative_to(prec_root)
    case_no = str(meta.get("사건번호") or "").strip()
    # law.go.kr 판례 영구링크는 사건번호 형식. (일련번호 형식은 에러 페이지가 뜬다)
    source_url = (
        f"https://www.law.go.kr/판례/({case_no})"
        if case_no
        else str(meta.get("출처") or "").strip()
    )

    return {
        "serial": str(meta.get("판례일련번호") or "").strip(),
        "case_name": str(meta.get("제목") or "").strip(),
        "case_no": case_no,
        "court": str(meta.get("법원명") or "").strip(),
        "case_type": str(meta.get("사건종류명") or "").strip(),
        "judgment_type": str(meta.get("판결유형") or "").strip(),
        "decided_date": decided,
        "decided_year": str(decided)[:4] if decided else "",
        "holding": sec.get("판시사항", ""),
        "summary": sec.get("판결요지", ""),
        "refs_article": _join_refs(meta.get("참조조문")) or sec.get("참조조문", ""),
        "body": sec.get("판례내용", ""),
        "source_url": source_url,
        "file_path": str(rel),
    }
