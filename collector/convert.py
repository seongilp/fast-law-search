"""행정규칙 본문(AdmRulService) → 기존 법령 markdown 포맷으로 변환하는 순수함수.

네트워크/파일 I/O 없음. 입력 dict → Converted. 단위 테스트로 검증한다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import yaml

# 가운뎃점 정규화: · (U+00B7) → ㆍ (U+318D) — 기존 저장소 규칙과 동일
_DOT = str.maketrans({"·": "ㆍ"})
_STRUCT = re.compile(r"^(제\d+편|제\d+장|제\d+절|제\d+관)\b")
_ART_PAREN = re.compile(r"^(제\d+조(?:의\d+)?)\s*\((.*?)\)\s*(.*)$", re.DOTALL)
_ART_PLAIN = re.compile(r"^(제\d+조(?:의\d+)?)(?:\s+(.*))?$", re.DOTALL)


@dataclass(frozen=True)
class Converted:
    name: str       # 정규화된 행정규칙명
    kind: str       # 행정규칙종류 (고시/훈령/예규/세칙…)
    rule_id: str    # 행정규칙ID
    mst: str        # 행정규칙일련번호
    markdown: str   # 전체 .md 텍스트


def _norm(s) -> str:
    return str(s or "").translate(_DOT).strip()


def _fmt_date(v) -> str:
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}" if len(digits) >= 8 else ""


def _ministries(v) -> list[str]:
    if not v:
        return []
    items = v if isinstance(v, list) else [v]
    return [_norm(x) for x in items if _norm(x)]


def _as_list(v) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _flatten(v) -> str:
    """문자열 또는 (중첩) 리스트를 한 문자열로."""
    if isinstance(v, list):
        return " ".join(_flatten(x) for x in v)
    return str(v or "")


def _annex_meta(annex) -> list[str]:
    out: list[str] = []
    if isinstance(annex, dict):
        for u in _as_list(annex.get("별표단위")):
            if isinstance(u, dict):
                title = _norm(u.get("별표제목"))
                pdf = str(u.get("별표서식PDF파일링크") or "").strip()
                out.append(f"{title} | {pdf}" if pdf else title)
    return out


def _annex_section(annex) -> list[str]:
    meta = _annex_meta(annex)
    if not meta:
        return []
    out = ["", "## 별표", ""]
    out += [f"- {m}" for m in meta]
    out.append("")
    return out


def _buchik_section(buchik) -> list[str]:
    if not isinstance(buchik, dict):
        return []
    items = [_flatten(x).strip() for x in _as_list(buchik.get("부칙내용"))]
    items = [x for x in items if x]
    if not items:
        return []
    out = ["", "## 부칙", ""]
    for x in items:
        out += [x, ""]
    return out


def _build_body(name: str, svc: dict) -> str:
    out: list[str] = [f"# {name}", ""]
    for raw in _as_list(svc.get("조문내용")):
        line = _flatten(raw).strip()
        if not line:
            continue
        if _STRUCT.match(line):
            out += ["", f"## {line}", ""]
            continue
        m = _ART_PAREN.match(line)
        if m:
            label, title, rest = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
            out += [f"##### {label} ({title})", "", rest, ""]
            continue
        m = _ART_PLAIN.match(line)
        if m and line.startswith("제"):
            label, rest = m.group(1), (m.group(2) or "").strip()
            out += [f"##### {label}", "", rest, ""]
            continue
        out += [line, ""]
    out += _annex_section(svc.get("별표"))
    out += _buchik_section(svc.get("부칙"))
    return "\n".join(out).strip()


def convert(body: dict) -> Converted:
    svc = body.get("AdmRulService", body) if isinstance(body, dict) else {}
    info = svc.get("행정규칙기본정보", {}) or {}

    name = _norm(info.get("행정규칙명"))
    kind = _norm(info.get("행정규칙종류")) or "행정규칙"
    rule_id = str(info.get("행정규칙ID") or "").strip()
    mst = str(info.get("행정규칙일련번호") or "").strip()

    frontmatter = {
        "제목": name,
        "법령MST": mst,
        "법령ID": rule_id,
        "법령구분": kind,
        "소관부처": _ministries(info.get("소관부처명")),
        "공포일자": _fmt_date(info.get("발령일자")),
        "공포번호": str(info.get("발령번호") or "").strip(),
        "시행일자": _fmt_date(info.get("시행일자")),
        "상태": "시행" if str(info.get("현행여부", "")).upper() == "Y" else "폐지",
        "출처": f"https://www.law.go.kr/행정규칙/{name}",
        "데이터구분": "행정규칙",
        "별표": _annex_meta(svc.get("별표")),
    }
    front = yaml.safe_dump(
        frontmatter, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).strip()
    body_md = _build_body(name, svc)
    return Converted(name, kind, rule_id, mst, f"---\n{front}\n---\n\n{body_md}\n")
