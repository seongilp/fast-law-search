"""환경설정 로딩. 모든 값은 .env 또는 환경변수에서 읽는다(하드코딩 금지)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# search/ 디렉터리의 .env 를 로드 (indexer/ 기준 상위)
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class Config:
    """불변 설정 객체."""

    api_key: str
    host: str
    port: str
    protocol: str
    collection: str
    law_root: Path

    @staticmethod
    def from_env() -> "Config":
        root = os.environ.get("LAW_ROOT", "../kr")
        # LAW_ROOT 는 search/ 기준 상대경로일 수 있으므로 search/ 기준으로 해석
        base = Path(__file__).resolve().parent.parent
        law_root = (base / root).resolve() if not os.path.isabs(root) else Path(root)
        if not law_root.is_dir():
            raise FileNotFoundError(f"LAW_ROOT 디렉터리를 찾을 수 없습니다: {law_root}")
        return Config(
            api_key=os.environ.get("TYPESENSE_API_KEY", "legalize_dev_key"),
            host=os.environ.get("TYPESENSE_HOST", "localhost"),
            port=os.environ.get("TYPESENSE_PORT", "8108"),
            protocol=os.environ.get("TYPESENSE_PROTOCOL", "http"),
            collection=os.environ.get("TYPESENSE_COLLECTION", "kr_laws"),
            law_root=law_root,
        )
