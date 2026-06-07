"""판례 markdown 경로 결정 + resume 인덱스 + 원자적 쓰기. 파일 I/O 전담."""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

_DOT = str.maketrans({"·": "ㆍ"})
_SERIAL_IN_NAME = re.compile(r"\((\d+)\)\.md$")


def _year(decided_date: str) -> str:
    d = "".join(ch for ch in str(decided_date or "") if ch.isdigit())
    return d[:4] if len(d) >= 4 else "unknown"


def _safe(case_no: str) -> str:
    """사건번호 → 파일명 안전화: 가운뎃점 정규화 + 슬래시 제거 + 공백 제거."""
    s = str(case_no or "").translate(_DOT).replace("/", "")
    return re.sub(r"\s+", "", s)


def resolve_path(root: Path, case_no: str, decided_date: str, serial: str) -> Path:
    """`root/{선고연도}/{사건번호}({판례일련번호}).md`."""
    return root / _year(decided_date) / f"{_safe(case_no)}({serial}).md"


def existing_serials(root: Path) -> set[str]:
    """이미 저장된 모든 판례일련번호 집합. resume(불변 스킵)용."""
    out: set[str] = set()
    if not root.is_dir():
        return out
    for p in root.rglob("*.md"):
        m = _SERIAL_IN_NAME.search(p.name)
        if m:
            out.add(m.group(1))
    return out


def write_markdown(path: Path, content: str) -> None:
    """고유 임시파일 → rename 으로 원자적 쓰기. 부분 파일 방지."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_name, path)
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise
