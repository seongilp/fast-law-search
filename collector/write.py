"""행정규칙 markdown 파일 경로 결정(충돌 해소) + 원자적 쓰기. 파일 I/O 전담."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from pathlib import Path

import yaml

_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
# 가운뎃점 정규화: · (U+00B7) → ㆍ (U+318D). convert.py 와 동일해야
# write 경로와 resume 체크 경로가 일치한다(목록 API 는 원본 ·, 본문은 정규화 후).
_DOT = str.maketrans({"·": "ㆍ"})

# 리눅스 ext4 는 경로 컴포넌트당 255바이트 제한. 한글은 UTF-8 3바이트라
# 긴 행정규칙명/판례명이 그대로 디렉터리가 되면 GitHub Pages checkout 이 깨진다.
# 여유를 둬 200바이트로 캡한다.
MAX_DIR_BYTES = 200
# 자를 때 붙이는 충돌 방지 해시(원래 이름이 다르면 디렉터리도 달라야 한다).
_HASH_SUFFIX_LEN = 8


def _dir_name(name: str) -> str:
    """행정규칙명/판례명 → 디렉터리명.

    가운뎃점 정규화 + 공백 제거(law.go.kr URL 규칙과 동일). 결과가
    `MAX_DIR_BYTES` 를 넘으면 UTF-8 경계에서 잘라내고 원본 해시를 붙여
    리눅스 파일명 제한을 지키면서 고유성·결정성을 보존한다(같은 이름 →
    같은 디렉터리라 resume/dedup 과 마이그레이션이 일관되게 동작한다).
    """
    base = re.sub(r"\s+", "", name.translate(_DOT))
    if len(base.encode("utf-8")) <= MAX_DIR_BYTES:
        return base
    suffix = "~" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:_HASH_SUFFIX_LEN]
    budget = MAX_DIR_BYTES - len(suffix)  # suffix 는 ASCII(9바이트)
    truncated = base.encode("utf-8")[:budget].decode("utf-8", "ignore")
    return truncated + suffix


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
    """고유 임시파일 → rename 으로 원자적 쓰기. 부분 파일 방지.

    임시파일명은 mkstemp 로 고유하게 만든다. 같은 최종 경로를 두 스레드가
    동시에 쓰더라도 임시파일이 겹치지 않아 os.replace race 가 발생하지 않는다.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_name, path)
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise
