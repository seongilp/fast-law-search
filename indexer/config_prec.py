"""판례 인덱서 설정. 모든 값은 .env/환경변수에서 읽는다(하드코딩 금지)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class PrecConfig:
    api_key: str
    host: str
    port: str
    protocol: str
    collection: str
    prec_root: Path

    @staticmethod
    def from_env() -> "PrecConfig":
        root = os.environ.get("PREC_ROOT", "../prec")
        base = Path(__file__).resolve().parent.parent
        prec_root = (base / root).resolve() if not os.path.isabs(root) else Path(root)
        if not prec_root.is_dir():
            raise FileNotFoundError(f"PREC_ROOT 디렉터리를 찾을 수 없습니다: {prec_root}")
        return PrecConfig(
            api_key=os.environ.get("TYPESENSE_API_KEY", "legalize_dev_key"),
            host=os.environ.get("TYPESENSE_HOST", "localhost"),
            port=os.environ.get("TYPESENSE_PORT", "8108"),
            protocol=os.environ.get("TYPESENSE_PROTOCOL", "http"),
            collection=os.environ.get("PREC_COLLECTION", "kr_precedents"),
            prec_root=prec_root,
        )
