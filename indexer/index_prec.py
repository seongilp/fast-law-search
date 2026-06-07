"""prec/ 의 모든 판례 .md 를 파싱해 Typesense 'kr_precedents' 컬렉션에 인덱싱한다.

사용:
    python index_prec.py            # 컬렉션 재생성 후 전량
    python index_prec.py --keep     # 기존 유지 후 upsert(증분)
    python index_prec.py --alias    # 무중단: 새 컬렉션 색인 → alias 전환 → 구 컬렉션 정리
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import typesense

from config_prec import PrecConfig
from parse_prec import parse_file
from schema_prec import collection_schema

BATCH = 2000


def _client(cfg: PrecConfig) -> typesense.Client:
    return typesense.Client({
        "api_key": cfg.api_key,
        "nodes": [{"host": cfg.host, "port": cfg.port, "protocol": cfg.protocol}],
        "connection_timeout_seconds": 60,
    })


def _import_batch(client: typesense.Client, name: str, docs: list[dict]) -> int:
    if not docs:
        return 0
    results = client.collections[name].documents.import_(docs, {"action": "upsert"})
    failures = [r for r in results if not r.get("success", False)]
    if failures:
        print(f"  [warn] {len(failures)}건 실패. 예: {failures[0].get('error')}", file=sys.stderr)
    return len(docs) - len(failures)


def _index_into(client: typesense.Client, cfg: PrecConfig, target: str) -> int:
    md_files = sorted(cfg.prec_root.rglob("*.md"))
    print(f"[scan] 판례 md {len(md_files)}개 → '{target}'")
    buffer: list[dict] = []
    indexed = parse_errors = 0
    for i, path in enumerate(md_files, 1):
        try:
            doc = parse_file(path, cfg.prec_root)
        except Exception as exc:
            parse_errors += 1
            print(f"  [skip] 파싱 실패 {path}: {exc}", file=sys.stderr)
            continue
        if not doc.get("serial"):
            continue
        doc["id"] = doc["serial"]      # 판례일련번호 = 도큐먼트 id (멱등 upsert)
        buffer.append(doc)
        if len(buffer) >= BATCH:
            indexed += _import_batch(client, target, buffer)
            buffer = []
        if i % 500 == 0:
            print(f"  [progress] {i}/{len(md_files)}")
    indexed += _import_batch(client, target, buffer)
    print("-" * 50)
    print(f"[done] 파일 {len(md_files)} (파싱오류 {parse_errors}) → 인덱싱 성공 {indexed}")
    return indexed


def _recreate(client: typesense.Client, name: str) -> None:
    try:
        client.collections[name].delete()
        print(f"[init] 기존 컬렉션 삭제: {name}")
    except typesense.exceptions.ObjectNotFound:
        pass
    client.collections.create(collection_schema(name))
    print(f"[init] 컬렉션 생성: {name}")


def _ensure(client: typesense.Client, name: str) -> None:
    try:
        client.collections[name].retrieve()
    except typesense.exceptions.ObjectNotFound:
        client.collections.create(collection_schema(name))
        print(f"[init] 컬렉션 생성: {name}")


def run(recreate: bool) -> None:
    cfg = PrecConfig.from_env()
    client = _client(cfg)
    print(f"[cfg] PREC_ROOT={cfg.prec_root}  collection={cfg.collection}")
    if recreate:
        _recreate(client, cfg.collection)
    else:
        _ensure(client, cfg.collection)
    _index_into(client, cfg, cfg.collection)


def run_alias(cfg: PrecConfig) -> None:
    client = _client(cfg)
    alias = cfg.collection
    new_name = f"{alias}_{int(time.time())}"
    print(f"[cfg] PREC_ROOT={cfg.prec_root}  alias={alias}  new={new_name}")
    client.collections.create(collection_schema(new_name))
    _index_into(client, cfg, new_name)
    client.aliases.upsert(alias, {"collection_name": new_name})
    print(f"[alias] '{alias}' → '{new_name}'")
    for c in client.collections.retrieve():
        name = c["name"]
        if name.startswith(f"{alias}_") and name != new_name:
            try:
                client.collections[name].delete()
                print(f"[cleanup] 옛 컬렉션 삭제: {name}")
            except typesense.exceptions.TypesenseClientError as exc:
                print(f"  [warn] 정리 실패 {name}: {exc}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description="대한민국 판례 Typesense 인덱서")
    ap.add_argument("--keep", action="store_true", help="기존 컬렉션 유지")
    ap.add_argument("--alias", action="store_true", help="무중단 재색인")
    args = ap.parse_args()
    try:
        if args.alias:
            run_alias(PrecConfig.from_env())
        else:
            run(recreate=not args.keep)
    except FileNotFoundError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    except typesense.exceptions.TypesenseClientError as exc:
        print(f"[error] Typesense 연결/요청 실패: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
