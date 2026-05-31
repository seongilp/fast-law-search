"""kr/ 의 모든 법령 .md 를 파싱해 Typesense 에 조문 단위로 인덱싱한다.

사용:
    python index.py            # 컬렉션 재생성 후 전량 인덱싱
    python index.py --keep     # 기존 컬렉션 유지(있으면) 후 upsert
    python index.py --alias    # 무중단: 새 타임스탬프 컬렉션에 색인 → alias 전환 → 구 컬렉션 정리

진행 상황을 stdout 으로 출력한다.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import time
from pathlib import Path

import typesense

from config import Config
from parse import Article, parse_file
from schema import collection_schema

BATCH = 2000


def _client(cfg: Config) -> typesense.Client:
    return typesense.Client(
        {
            "api_key": cfg.api_key,
            "nodes": [{"host": cfg.host, "port": cfg.port, "protocol": cfg.protocol}],
            "connection_timeout_seconds": 60,
        }
    )


def _doc_id(file_path: str, label: str, seq: int) -> str:
    raw = f"{file_path}#{label}#{seq}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def _to_doc(meta: dict, art: Article) -> dict:
    return {
        "id": _doc_id(meta["file_path"], art.article_label, art.article_seq),
        "content": art.content,
        "article_title": art.article_title,
        "law_name": meta["law_name"],
        "chapter": art.chapter,
        "law_type": meta["law_type"],
        "ministry": meta["ministry"],
        "status": meta["status"],
        "article_label": art.article_label,
        "article_no": art.article_no,
        "article_seq": art.article_seq,
        "promulgation_date": meta["promulgation_date"],
        "enforcement_date": meta["enforcement_date"],
        "law_dir": meta["law_dir"],
        "mst": meta["mst"],
        "source_url": meta["source_url"],
        "file_path": meta["file_path"],
    }


def _recreate_collection(client: typesense.Client, name: str) -> None:
    try:
        client.collections[name].delete()
        print(f"[init] 기존 컬렉션 삭제: {name}")
    except typesense.exceptions.ObjectNotFound:
        pass
    client.collections.create(collection_schema(name))
    print(f"[init] 컬렉션 생성: {name}")


def _ensure_collection(client: typesense.Client, name: str) -> None:
    try:
        client.collections[name].retrieve()
    except typesense.exceptions.ObjectNotFound:
        client.collections.create(collection_schema(name))
        print(f"[init] 컬렉션 생성: {name}")


def _import_batch(client: typesense.Client, name: str, docs: list[dict]) -> int:
    if not docs:
        return 0
    results = client.collections[name].documents.import_(docs, {"action": "upsert"})
    failures = [r for r in results if not r.get("success", False)]
    if failures:
        # 첫 실패만 표본 출력(노이즈 방지), 전체는 카운트
        print(f"  [warn] {len(failures)}건 실패. 예: {failures[0].get('error')}", file=sys.stderr)
    return len(docs) - len(failures)


def _index_into(client: typesense.Client, cfg: Config, target: str) -> int:
    """target 컬렉션에 kr/ 전량을 색인하고 인덱싱 성공 건수를 반환."""
    md_files = sorted(cfg.law_root.rglob("*.md"))
    print(f"[scan] md 파일 {len(md_files)}개 발견 → '{target}'")

    buffer: list[dict] = []
    total_docs = 0
    indexed = 0
    parse_errors = 0

    for i, path in enumerate(md_files, 1):
        try:
            meta, articles = parse_file(path, cfg.law_root)
        except Exception as exc:  # 파일 단위 격리: 한 파일 오류가 전체를 막지 않음
            parse_errors += 1
            print(f"  [skip] 파싱 실패 {path}: {exc}", file=sys.stderr)
            continue
        for art in articles:
            buffer.append(_to_doc(meta, art))
            total_docs += 1
            if len(buffer) >= BATCH:
                indexed += _import_batch(client, target, buffer)
                buffer = []
        if i % 200 == 0:
            print(f"  [progress] {i}/{len(md_files)} 파일, 누적 도큐먼트 {total_docs}")

    indexed += _import_batch(client, target, buffer)

    print("-" * 50)
    print(
        f"[done] 파일 {len(md_files)}개 (파싱오류 {parse_errors}) → "
        f"조문 도큐먼트 {total_docs}, 인덱싱 성공 {indexed}"
    )
    return indexed


def run(recreate: bool) -> None:
    cfg = Config.from_env()
    client = _client(cfg)
    print(f"[cfg] LAW_ROOT={cfg.law_root}  collection={cfg.collection}")

    if recreate:
        _recreate_collection(client, cfg.collection)
    else:
        _ensure_collection(client, cfg.collection)

    _index_into(client, cfg, cfg.collection)


def _list_collection_names(client: typesense.Client) -> list[str]:
    return [c["name"] for c in client.collections.retrieve()]


def run_alias(cfg: Config) -> None:
    """무중단 재색인:
    1) 타임스탬프 컬렉션(kr_laws_<ts>) 생성 후 전량 색인
    2) alias(cfg.collection)를 새 컬렉션으로 전환 — UI 는 alias 만 보므로 끊김 0
    3) alias 가 가리키지 않는 옛 kr_laws_* 컬렉션 정리
    """
    client = _client(cfg)
    alias = cfg.collection
    new_name = f"{alias}_{int(time.time())}"
    print(f"[cfg] LAW_ROOT={cfg.law_root}  alias={alias}  new_collection={new_name}")

    # 1) 새 컬렉션 생성 + 색인
    client.collections.create(collection_schema(new_name))
    print(f"[init] 새 컬렉션 생성: {new_name}")
    _index_into(client, cfg, new_name)

    # 2) alias 전환 (원자적)
    client.aliases.upsert(alias, {"collection_name": new_name})
    print(f"[alias] '{alias}' → '{new_name}' 전환 완료")

    # 3) 옛 컬렉션 정리 (방금 만든 것 + 혹시 동명 컬렉션은 보존)
    for name in _list_collection_names(client):
        if name.startswith(f"{alias}_") and name != new_name:
            try:
                client.collections[name].delete()
                print(f"[cleanup] 옛 컬렉션 삭제: {name}")
            except typesense.exceptions.TypesenseClientError as exc:
                print(f"  [warn] 정리 실패 {name}: {exc}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description="대한민국 법령 Typesense 인덱서")
    ap.add_argument("--keep", action="store_true", help="기존 컬렉션 유지(재생성하지 않음)")
    ap.add_argument(
        "--alias",
        action="store_true",
        help="무중단 재색인: 새 컬렉션 색인 후 alias 전환, 구 컬렉션 정리",
    )
    args = ap.parse_args()
    try:
        if args.alias:
            run_alias(Config.from_env())
        else:
            run(recreate=not args.keep)
    except FileNotFoundError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    except typesense.exceptions.TypesenseClientError as exc:
        print(f"[error] Typesense 연결/요청 실패: {exc}", file=sys.stderr)
        print("        docker compose up -d 로 Typesense 가 떠 있는지 확인하세요.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
