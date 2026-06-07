"""prec/ 의 신규(미추적/수정) 판례 .md 를 선고일자 커밋으로 1건씩 기록한다.

판례는 불변 → 1판례=1커밋. author/committer date = 선고일자.
Git 은 1970-01-01 이전을 지원하지 않으므로 epoch 로 클램프(frontmatter 가 진실).

사용:
    python -m collector_prec.commit            # prec/ 미커밋 파일 전부 커밋
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_REPO = Path(__file__).resolve().parent.parent.parent     # law.zihado.com 루트
_PREC = _REPO / "prec"


def _field(text: str, key: str) -> str:
    m = _FRONT.match(text)
    block = m.group(1) if m else ""
    fm = re.search(rf"^{key}:\s*(.+)$", block, re.MULTILINE)
    return fm.group(1).strip().strip('"') if fm else ""


def _git(args: list[str], env: dict | None = None) -> str:
    out = subprocess.run(
        ["git", "-C", str(_REPO), *args],
        check=True, capture_output=True, text=True,
        env={**os.environ, **(env or {})},
    )
    return out.stdout.strip()


def _pending() -> list[str]:
    """prec/ 아래 미추적 + 수정된 .md 경로(레포 상대)."""
    status = _git(["-c", "core.quotePath=false", "status", "--porcelain", "-u", "--", "prec"])
    paths: list[str] = []
    for line in status.splitlines():
        path = line[3:].strip().strip('"')
        if path.endswith(".md"):
            paths.append(path)
    return sorted(paths)


def _commit_one(rel_path: str) -> None:
    text = (_REPO / rel_path).read_text(encoding="utf-8")
    name = _field(text, "제목") or "판례"
    case_no = _field(text, "사건번호")
    case_type = _field(text, "사건종류명")
    jtype = _field(text, "판결유형")
    serial = _field(text, "판례일련번호")
    decided = _field(text, "선고일자")  # YYYY-MM-DD

    # Git 은 epoch 이전 날짜 미지원 → 클램프
    date_iso = f"{decided}T00:00:00" if decided and decided >= "1970-01-01" else "1970-01-01T00:00:00"

    subject = f"판례: {name} [대법원 {case_no}]"
    bodylines = [
        f"선고일자: {decided} | 사건종류: {case_type} | 판결유형: {jtype}",
        f"판례일련번호: {serial}",
        f"출처: https://www.law.go.kr/판례/({serial})",
    ]
    message = subject + "\n\n" + "\n".join(bodylines) + "\n"

    _git(["add", "--", rel_path])
    env = {"GIT_AUTHOR_DATE": date_iso, "GIT_COMMITTER_DATE": date_iso}
    _git(["commit", "-q", "-m", message, "--", rel_path], env=env)


def main() -> int:
    pending = _pending()
    if not pending:
        print("[commit] 커밋할 판례 없음")
        return 0
    print(f"[commit] 대상 {len(pending)}건")
    for i, rel in enumerate(pending, 1):
        try:
            _commit_one(rel)
        except subprocess.CalledProcessError as exc:
            print(f"  [fail] {rel}: {exc.stderr}", file=sys.stderr)
        if i % 200 == 0:
            print(f"  [progress] {i}/{len(pending)}")
    print(f"[done] 커밋 완료 {len(pending)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
