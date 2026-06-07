"""kr/ 하위 행정규칙·판례 디렉터리명을 새 `_dir_name`(200바이트 캡) 기준으로 정규화.

리눅스 ext4 의 255바이트 컴포넌트 제한 때문에 긴 한글 디렉터리가 GitHub Pages
checkout 을 깨뜨린다. 생성기(`write._dir_name`)를 캡하도록 고친 뒤, 이미 디스크에
쓰여진 기존 디렉터리도 같은 규칙으로 한 번 옮겨 생성기의 resume 경로와 일치시킨다.

tracked 파일은 `git mv`(이력 보존), untracked 는 `os.rename`. idempotent.

    python -m collector.migrate_long_dirs <kr_root> [--apply]

--apply 없으면 dry-run.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from collector.write import MAX_DIR_BYTES, _dir_name


def _tracked(path: Path, repo: Path) -> bool:
    rel = path.relative_to(repo)
    out = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z", "--", str(rel)],
        capture_output=True,
    )
    return bool(out.stdout)


def plan(kr_root: Path) -> list[tuple[Path, Path]]:
    """이름이 바뀌어야 하는 (old, new) 디렉터리 목록."""
    moves: list[tuple[Path, Path]] = []
    for child in sorted(kr_root.iterdir()):
        if not child.is_dir():
            continue
        if len(child.name.encode("utf-8")) <= MAX_DIR_BYTES:
            continue
        new = kr_root / _dir_name(child.name)
        if new != child:
            moves.append((child, new))
    return moves


def apply(repo: Path, moves: list[tuple[Path, Path]]) -> None:
    for old, new in moves:
        if new.exists():
            raise SystemExit(f"대상 이미 존재(충돌): {new}")
        if _tracked(old, repo):
            subprocess.run(
                ["git", "-C", str(repo), "mv", str(old.relative_to(repo)), str(new.relative_to(repo))],
                check=True,
            )
        else:
            old.rename(new)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    kr_root = Path(argv[0]).resolve()
    do_apply = "--apply" in argv[1:]
    repo = kr_root.parent  # kr/ 의 부모가 repo 루트

    moves = plan(kr_root)
    print(f"대상 디렉터리: {len(moves)}개 (200바이트 초과)")
    for old, new in moves:
        ob = len(old.name.encode("utf-8"))
        print(f"  [{ob}B] {old.name[:50]}…  ->  {new.name}")
    if not moves:
        print("변경 없음.")
        return 0
    if not do_apply:
        print("\n(dry-run) 실제 적용하려면 --apply")
        return 0
    apply(repo, moves)
    print(f"\n완료: {len(moves)}개 이동.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
