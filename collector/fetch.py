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

from collector.client import LawApiClient, LawApiError, RuleMeta
from collector.config import CollectorConfig
from collector.convert import convert
from collector.write import existing_mst, resolve_path, write_markdown


def _process(client: LawApiClient, cfg: CollectorConfig, meta: RuleMeta) -> str:
    """단건 처리. 반환: 'skip' | 'write' | 'fail'."""
    # resume: 기본 경로에 동일 MST 파일이 이미 있으면 본문 조회 없이 스킵
    base = resolve_path(cfg.admrule_root, meta.name, meta.kind, meta.rule_id)
    if base.exists() and existing_mst(base) == meta.mst and meta.mst:
        return "skip"
    try:
        body = client.fetch_body(meta.rule_id)
        conv = convert(body)
        path = resolve_path(cfg.admrule_root, conv.name, conv.kind, conv.rule_id)
        write_markdown(path, conv.markdown)
        return "write"
    except (LawApiError, OSError, KeyError) as exc:
        print(f"  [skip] 실패 {meta.name}(LID={meta.rule_id}): {exc}", file=sys.stderr)
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

    counts = {"skip": 0, "write": 0, "fail": 0}
    done = 0
    with ThreadPoolExecutor(max_workers=cfg.concurrency) as pool:
        futures = {pool.submit(_process, client, cfg, m): m for m in metas}
        for fut in as_completed(futures):
            counts[fut.result()] += 1
            done += 1
            if done % 200 == 0:
                print(f"  [progress] {done}/{len(metas)} "
                      f"(write {counts['write']}, skip {counts['skip']}, fail {counts['fail']})")

    print("-" * 50)
    print(f"[done] 처리 {len(metas)} → 저장 {counts['write']}, "
          f"스킵 {counts['skip']}, 실패 {counts['fail']}")
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
