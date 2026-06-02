"""행정규칙 수집기 설정. 모든 값은 .env/환경변수에서 읽는다(하드코딩 금지)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class CollectorConfig:
    oc: str
    admrule_root: Path
    concurrency: int
    retry: int

    @staticmethod
    def from_env() -> "CollectorConfig":
        root = os.environ.get("ADMRULE_ROOT", "../kr")
        base = Path(__file__).resolve().parent.parent
        admrule_root = (base / root).resolve() if not os.path.isabs(root) else Path(root)
        admrule_root.mkdir(parents=True, exist_ok=True)
        return CollectorConfig(
            oc=os.environ.get("LAW_GO_KR_OC", ""),
            admrule_root=admrule_root,
            concurrency=int(os.environ.get("COLLECT_CONCURRENCY", "6")),
            retry=int(os.environ.get("COLLECT_RETRY", "3")),
        )
