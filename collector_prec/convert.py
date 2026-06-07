"""판례 본문(PrecService) → 판례 markdown 으로 변환하는 순수함수.

네트워크/파일 I/O 없음. 입력 dict → Converted. 단위 테스트로 검증한다.
법령 collector/convert.py 와 동일한 가운뎃점 정규화 규칙을 따른다.
"""
from __future__ import annotations

import datetime
import re
from dataclasses import dataclass

import yaml

_DOT = str.maketrans({"·": "ㆍ"})          # · (U+00B7) → ㆍ (U+318D)
_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


class _DQ(str):
    """YAML 출력 시 쌍따옴표 강제. 숫자처럼 보이는 문자열 식별자(일련번호)에 사용."""


def _dq_representer(dumper: yaml.Dumper, data: "_DQ") -> yaml.ScalarNode:
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style='"')


yaml.SafeDumper.add_representer(_DQ, _dq_representer)


@dataclass(frozen=True)
class Converted:
    serial: str        # 판례정보일련번호
    case_no: str       # 사건번호(정제형)
    decided_date: str  # YYYY-MM-DD
    case_name: str     # 사건명
    markdown: str      # 전체 .md 텍스트


def _norm(s) -> str:
    return str(s or "").translate(_DOT).strip()


def _fmt_date(v) -> str:
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}" if len(digits) >= 8 else ""


def _clean(v) -> str:
    """<br/> → 줄바꿈, 잔여 태그 제거, 가운뎃점 정규화, 양끝 공백 정리."""
    s = _BR.sub("\n", str(v or ""))
    s = _TAG.sub("", s)
    s = s.translate(_DOT)
    lines = [ln.strip() for ln in s.splitlines()]
    return "\n".join(lines).strip()


def _refs(v) -> list[str]:
    """참조조문/참조판례 문자열 → 리스트. '/' 와 줄바꿈으로 분리."""
    text = _clean(v)
    if not text:
        return []
    parts = re.split(r"[/\n]", text)
    out: list[str] = []
    for p in parts:
        p = p.strip(" .")
        if p:
            out.append(p)
    return out


def _section(title: str, value) -> list[str]:
    text = _clean(value)
    if not text:
        return []
    return ["", f"## {title}", "", text]


def convert(body: dict) -> Converted:
    svc = body.get("PrecService") if isinstance(body, dict) else None
    if not isinstance(svc, dict) or not svc:
        raise ValueError("PrecService 본문이 없습니다(미제공 판례)")

    serial = str(svc.get("판례정보일련번호") or "").strip()
    case_no = _norm(svc.get("사건번호"))
    case_name = _norm(svc.get("사건명")) or case_no
    decided = _fmt_date(svc.get("선고일자"))

    # YAML date object → renders as 2022-08-19 (unquoted)
    decided_obj: datetime.date | str = decided
    if decided:
        try:
            y, m, d = decided.split("-")
            decided_obj = datetime.date(int(y), int(m), int(d))
        except (ValueError, AttributeError):
            decided_obj = decided

    frontmatter = {
        "제목": case_name,
        "판례일련번호": _DQ(serial),
        "사건번호": case_no,
        "법원명": _norm(svc.get("법원명")),
        "법원종류코드": str(svc.get("법원종류코드") or "").strip(),
        "사건종류명": _norm(svc.get("사건종류명")),
        "사건종류코드": str(svc.get("사건종류코드") or "").strip(),
        "판결유형": _norm(svc.get("판결유형")),
        "선고": _norm(svc.get("선고")),
        "선고일자": decided_obj,
        "참조조문": _refs(svc.get("참조조문")),
        "참조판례": _refs(svc.get("참조판례")),
        "상태": "시행",
        # law.go.kr 판례 영구링크는 사건번호 형식(일련번호 형식은 에러 페이지).
        "출처": f"https://www.law.go.kr/판례/({case_no})",
        "데이터구분": "판례",
    }
    # 빈 리스트 키는 제거(노이즈 방지)
    frontmatter = {k: v for k, v in frontmatter.items() if not (isinstance(v, list) and not v)}

    front = yaml.safe_dump(
        frontmatter, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).strip()

    body_lines: list[str] = [f"# {case_name}"]
    body_lines += _section("판시사항", svc.get("판시사항"))
    body_lines += _section("판결요지", svc.get("판결요지"))
    body_lines += _section("참조조문", svc.get("참조조문"))
    body_lines += _section("참조판례", svc.get("참조판례"))
    body_lines += _section("판례내용", svc.get("판례내용"))
    body_md = "\n".join(body_lines).strip()

    return Converted(serial, case_no, decided, case_name, f"---\n{front}\n---\n\n{body_md}\n")
