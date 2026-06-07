"""대법원 판례 전량 수집 오케스트레이션.

흐름: 목록 페이징 → (resume: 이미 저장된 일련번호면 스킵) → 본문 조회
      → convert → prec/ 에 원자적 저장. 한 건 실패가 전체를 막지 않음.

사용:
    python -m collector_prec.fetch            # 전량 수집(신규만)
    python -m collector_prec.fetch --limit 5  # 앞 5건만 (스모크 테스트)
"""
from __future__ import annotations

import argparse
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from collector_prec.client import EmptyBodyError, LawApiError, PrecApiClient, PrecMeta
from collector_prec.config import CollectorConfig
from collector_prec.convert import convert
from collector_prec.write import existing_serials, resolve_path, write_markdown

_write_lock = threading.Lock()


def _process(client: PrecApiClient, cfg: CollectorConfig, meta: PrecMeta) -> str:
    """단건 처리. 반환: 'skip' | 'write' | 'empty' | 'fail'."""
    try:
        body = client.fetch_body(meta.serial)        # 느린 네트워크 — 락 밖, 병렬
        conv = convert(body)
        with _write_lock:
            path = resolve_path(cfg.prec_root, conv.case_no, conv.decided_date, conv.serial)
            write_markdown(path, conv.markdown)
        return "write"
    except EmptyBodyError:
        return "empty"
    except (LawApiError, ValueError, OSError, KeyError) as exc:
        print(f"  [fail] {meta.case_name}(ID={meta.serial}): {exc}", file=sys.stderr)
        return "fail"


def run(limit: int | None) -> int:
    cfg = CollectorConfig.from_env()
    client = PrecApiClient(cfg.oc, retry=cfg.retry)
    total = client.total_count()
    seen = existing_serials(cfg.prec_root)
    print(f"[cfg] PREC_ROOT={cfg.prec_root}  총 {total}건  이미저장 {len(seen)}건  "
          f"concurrency={cfg.concurrency}  limit={limit}")

    metas: list[PrecMeta] = []
    for m in client.list_precedents():
        if m.serial in seen:        # resume: 불변 → 이미 있으면 스킵
            continue
        metas.append(m)
        if limit and len(metas) >= limit:
            break
    print(f"[list] 신규 메타 {len(metas)}건 → 본문 처리 시작")

    counts = {"skip": 0, "write": 0, "empty": 0, "fail": 0}
    done = 0
    with ThreadPoolExecutor(max_workers=cfg.concurrency) as pool:
        futures = {pool.submit(_process, client, cfg, m): m for m in metas}
        for fut in as_completed(futures):
            counts[fut.result()] += 1
            done += 1
            if done % 200 == 0:
                print(f"  [progress] {done}/{len(metas)} "
                      f"(write {counts['write']}, empty {counts['empty']}, fail {counts['fail']})")

    print("-" * 50)
    print(f"[done] 처리 {len(metas)} → 저장 {counts['write']}, "
          f"본문미제공 {counts['empty']}, 실패 {counts['fail']}")
    return 0 if counts["fail"] == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="대법원 판례 전량 수집기")
    ap.add_argument("--limit", type=int, default=None, help="앞 N건만 처리(스모크)")
    args = ap.parse_args()
    try:
        return run(args.limit)
    except LawApiError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
