"""law.go.kr OpenAPI 판례 클라이언트. 네트워크 I/O + throttle + retry 전담.

목록: lawSearch.do?target=prec&org=400201 (display=100, 페이징)
본문: lawService.do?target=prec&ID={판례일련번호}
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Iterator

import requests

_SEARCH = "https://www.law.go.kr/DRF/lawSearch.do"
_SERVICE = "https://www.law.go.kr/DRF/lawService.do"
_MIN_INTERVAL = 0.15  # 요청 간 최소 간격(초) — 정부 API 보호
_SUPREME = "400201"   # 대법원


@dataclass(frozen=True)
class PrecMeta:
    serial: str        # 판례일련번호
    case_no: str       # 사건번호(목록형, 대시 표기 가능)
    case_name: str
    decided_date: str  # 목록 원본(예: 2022.08.19)


class LawApiError(RuntimeError):
    """네트워크/HTTP/파싱 등 재시도 가치가 있는 일시적 오류."""


class EmptyBodyError(LawApiError):
    """JSON 본문(PrecService)을 제공하지 않는 판례(국세 등 HTML 전용). 정상 스킵."""


class PrecApiClient:
    def __init__(self, oc: str, retry: int = 3, timeout: int = 30) -> None:
        if not oc:
            raise LawApiError("LAW_GO_KR_OC 가 비어 있습니다 (.env 확인)")
        self._oc = oc
        self._retry = retry
        self._timeout = timeout
        self._session = requests.Session()
        self._last = 0.0
        self._lock = threading.Lock()

    def _throttle(self) -> None:
        with self._lock:
            gap = time.monotonic() - self._last
            if gap < _MIN_INTERVAL:
                time.sleep(_MIN_INTERVAL - gap)
            self._last = time.monotonic()

    def _get_json(self, url: str, params: dict) -> dict:
        last_exc: Exception | None = None
        for attempt in range(self._retry):
            self._throttle()
            try:
                r = self._session.get(url, params=params, timeout=self._timeout)
                if r.status_code != 200:
                    raise LawApiError(f"HTTP {r.status_code}")
                return r.json()
            except (requests.RequestException, ValueError, LawApiError) as exc:
                last_exc = exc
                time.sleep(min(2 ** attempt, 8))
        raise LawApiError(f"요청 실패({self._retry}회): {url} :: {last_exc}")

    def total_count(self) -> int:
        data = self._get_json(
            _SEARCH,
            {"OC": self._oc, "target": "prec", "type": "json",
             "org": _SUPREME, "display": 1, "page": 1},
        )
        return int(data.get("PrecSearch", {}).get("totalCnt", 0))

    def list_precedents(self) -> Iterator[PrecMeta]:
        """대법원 판례 전체를 페이징하며 메타를 순차 산출."""
        page = 1
        while True:
            data = self._get_json(
                _SEARCH,
                {"OC": self._oc, "target": "prec", "type": "json",
                 "org": _SUPREME, "display": 100, "page": page},
            )
            rows = data.get("PrecSearch", {}).get("prec", [])
            rows = [rows] if isinstance(rows, dict) else (rows or [])
            if not rows:
                return
            for r in rows:
                yield PrecMeta(
                    serial=str(r.get("판례일련번호") or "").strip(),
                    case_no=str(r.get("사건번호") or "").strip(),
                    case_name=str(r.get("사건명") or "").strip(),
                    decided_date=str(r.get("선고일자") or "").strip(),
                )
            if len(rows) < 100:
                return
            page += 1

    def fetch_body(self, serial: str) -> dict:
        """본문 조회. ID = 판례일련번호."""
        data = self._get_json(
            _SERVICE,
            {"OC": self._oc, "target": "prec", "type": "json", "ID": serial},
        )
        if "PrecService" not in data:
            raise EmptyBodyError(f"본문 미제공(ID={serial})")
        return data
