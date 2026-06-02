"""행정규칙 markdown 파일 경로 결정(충돌 해소) + 원자적 쓰기. 파일 I/O 전담."""
from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _dir_name(name: str) -> str:
    """행정규칙명 → 디렉터리명(공백 제거). law.go.kr URL 규칙과 동일."""
    return re.sub(r"\s+", "", name)


def _frontmatter(path: Path) -> dict:
    if not path.exists():
        return {}
    m = _FRONT.match(path.read_text(encoding="utf-8"))
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1)) or {}
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


def existing_mst(path: Path) -> str:
    return str(_frontmatter(path).get("법령MST") or "").strip()


def resolve_path(root: Path, name: str, kind: str, rule_id: str) -> Path:
    """`root/{명}/{종류}.md`. 다른 행정규칙ID 가 이미 점유 시 `{종류}({ID}).md`."""
    d = root / _dir_name(name)
    base = d / f"{kind}.md"
    if not base.exists():
        return base
    if str(_frontmatter(base).get("법령ID") or "").strip() == str(rule_id).strip():
        return base
    return d / f"{kind}({rule_id}).md"


def write_markdown(path: Path, content: str) -> None:
    """임시파일 → rename 으로 원자적 쓰기. 부분 파일 방지."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)
