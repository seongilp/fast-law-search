"""행정규칙 전량 수집 오케스트레이션.

흐름: 목록 페이징 → (resume: 동일 MST 파일 있으면 스킵) → 본문 LID 조회
      → convert → kr/ 에 원자적 저장. 한 건 실패가 전체를 막지 않음.

사용:
    python -m collector.fetch            # 전량 수집(변경분만)
    python -m collector.fetch --limit 5  # 앞 5건만 (스모크 테스트)
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from collector.client import EmptyBodyError, LawApiClient, LawApiError, RuleMeta
from collector.config import CollectorConfig
from collector.convert import convert
from collector.write import existing_mst, resolve_path, write_markdown


def _process(client: LawApiClient, cfg: CollectorConfig, meta: RuleMeta) -> str:
    """단건 처리. 반환: 'skip' | 'write' | 'empty' | 'fail'.

    'empty' = 소스가 본문을 제공하지 않는 규칙(정상 스킵, 하드 실패 아님).
    """
    # resume: 기본 경로에 동일 MST 파일이 이미 있으면 본문 조회 없이 스킵
    base = resolve_path(cfg.admrule_root, meta.name, meta.kind, meta.rule_id)
    if base.exists() and existing_mst(base) == meta.mst and meta.mst:
        return "skip"
    try:
        body = client.fetch_body(meta.mst)
        conv = convert(body)
        path = resolve_path(cfg.admrule_root, conv.name, conv.kind, conv.rule_id)
        write_markdown(path, conv.markdown)
        return "write"
    except EmptyBodyError:
        return "empty"
    except (LawApiError, OSError, KeyError) as exc:
        print(f"  [fail] {meta.name}(ID={meta.mst}): {exc}", file=sys.stderr)
        return "fail"


def run(limit: int | None) -> int:
    cfg = CollectorConfig.from_env()
    client = LawApiClient(cfg.oc, retry=cfg.retry)
    total = client.total_count()
    print(f"[cfg] ADMRULE_ROOT={cfg.admrule_root}  총 {total}건  "
          f"concurrency={cfg.concurrency}  limit={limit}")

    metas: list[RuleMeta] = []
    for m in client.list_rules():
        metas.append(m)
        if limit and len(metas) >= limit:
            break
    print(f"[list] 메타 {len(metas)}건 수집 완료 → 본문 처리 시작")

    counts = {"skip": 0, "write": 0, "empty": 0, "fail": 0}
    empties: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=cfg.concurrency) as pool:
        futures = {pool.submit(_process, client, cfg, m): m for m in metas}
        for fut in as_completed(futures):
            result = fut.result()
            counts[result] += 1
            if result == "empty":
                m = futures[fut]
                empties.append(f"{m.mst}\t{m.kind}\t{m.name}")
            done += 1
            if done % 200 == 0:
                print(f"  [progress] {done}/{len(metas)} "
                      f"(write {counts['write']}, skip {counts['skip']}, "
                      f"empty {counts['empty']}, fail {counts['fail']})")

    # 본문 미제공 규칙 명단을 파일로 남긴다(무언의 누락 방지: 무엇이 빠졌는지 투명 기록).
    if empties:
        report = Path(__file__).resolve().parent / "no_body.txt"
        try:
            report.write_text("\n".join(sorted(empties)) + "\n", encoding="utf-8")
            print(f"[note] 본문 미제공 {len(empties)}건 명단 기록: {report}")
        except OSError as exc:
            print(f"  [warn] 명단 기록 실패: {exc}", file=sys.stderr)

    print("-" * 50)
    print(f"[done] 처리 {len(metas)} → 저장 {counts['write']}, 스킵 {counts['skip']}, "
          f"본문미제공 {counts['empty']}, 실패 {counts['fail']}")
    # 본문 미제공(empty)은 소스 한계라 정상으로 본다. 하드 실패(fail)만 비정상 종료.
    return 0 if counts["fail"] == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="행정규칙 전량 수집기")
    ap.add_argument("--limit", type=int, default=None, help="앞 N건만 처리(스모크)")
    args = ap.parse_args()
    try:
        return run(args.limit)
    except LawApiError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
