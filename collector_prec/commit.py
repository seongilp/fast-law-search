"""prec/ 의 신규(미추적/수정) 판례 .md 를 단일 커밋으로 기록한다.

판례는 불변 문서이고 수만 건을 한 번에 적재하므로, 파일마다 커밋하지 않고
**한 번의 수집 = 한 커밋**으로 묶는다. 선고일자·사건번호 등 날짜/메타는 각
파일의 frontmatter 가 진실의 원천이므로 커밋 author date 로 분리할 필요가 없다.

사용:
    python -m collector_prec.commit            # prec/ 미커밋 파일을 한 커밋으로
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# 데이터(prec/)는 코드와 같은 repo(fast-law-search) 루트에 있다.
# 레이아웃이 다른 환경에서는 PREC_REPO 환경변수로 재정의 가능.
_REPO = (
    Path(os.environ["PREC_REPO"]).resolve()
    if os.environ.get("PREC_REPO")
    else Path(__file__).resolve().parent.parent
)
_PREC = _REPO / "prec"


def _git(args: list[str]) -> str:
    out = subprocess.run(
        ["git", "-C", str(_REPO), *args],
        check=True, capture_output=True, text=True,
        env={**os.environ},
    )
    return out.stdout.strip()


def _pending_count() -> int:
    """prec/ 아래 미추적 + 수정된 .md 파일 수."""
    status = _git(["-c", "core.quotePath=false", "status", "--porcelain", "-u", "--", "prec"])
    return sum(1 for line in status.splitlines() if line[3:].strip().strip('"').endswith(".md"))


def main() -> int:
    if not _PREC.is_dir():
        print("[commit] prec/ 디렉터리가 없습니다", file=sys.stderr)
        return 1

    count = _pending_count()
    if count == 0:
        print("[commit] 커밋할 판례 없음")
        return 0

    message = (
        f"판례: 대법원 판례 {count}건 추가\n\n"
        "선고일자·사건번호 등 메타는 각 파일 frontmatter 를 참조하세요.\n"
        "출처: 국가법령정보센터 OpenAPI (https://open.law.go.kr)\n"
    )
    try:
        _git(["add", "--", "prec"])
        _git(["commit", "-q", "-m", message, "--", "prec"])
    except subprocess.CalledProcessError as exc:
        print(f"[fail] 커밋 실패: {exc.stderr}", file=sys.stderr)
        return 1

    print(f"[done] 판례 {count}건을 단일 커밋으로 기록")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
