"""law.go.kr OpenAPI 클라이언트. 네트워크 I/O + throttle + retry 전담.

목록: lawSearch.do?target=admrul (display=100, 페이징)
본문: lawService.do?target=admrul&ID={행정규칙일련번호}
      (★ 공식 상세링크가 쓰는 ID=일련번호 가 보편적으로 동작한다.
       LID=행정규칙ID 는 일부만 되고 다수 훈령/예규에서 실패하므로 쓰지 않는다.)
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterator

import requests

_SEARCH = "https://www.law.go.kr/DRF/lawSearch.do"
_SERVICE = "https://www.law.go.kr/DRF/lawService.do"
_MIN_INTERVAL = 0.15  # 요청 간 최소 간격(초) — 정부 API 보호


@dataclass(frozen=True)
class RuleMeta:
    rule_id: str   # 행정규칙ID
    mst: str       # 행정규칙일련번호
    name: str
    kind: str


class LawApiError(RuntimeError):
    """네트워크/HTTP/파싱 등 재시도 가치가 있는 일시적 오류."""


class EmptyBodyError(LawApiError):
    """API 가 구조화 본문(AdmRulService)을 제공하지 않는 규칙.

    일부 행정규칙은 JSON 본문이 빈 `{}` 또는 오류 뷰어 HTML 로만 응답한다
    (소스 데이터 한계). 재시도해도 동일하므로 '정상 스킵'으로 분류한다.
    """


class LawApiClient:
    def __init__(self, oc: str, retry: int = 3, timeout: int = 30) -> None:
        if not oc:
            raise LawApiError("LAW_GO_KR_OC 가 비어 있습니다 (.env 확인)")
        self._oc = oc
        self._retry = retry
        self._timeout = timeout
        self._session = requests.Session()
        self._last = 0.0

    def _throttle(self) -> None:
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
                time.sleep(min(2 ** attempt, 8))  # 지수 백오프
        raise LawApiError(f"요청 실패({self._retry}회): {url} :: {last_exc}")

    def total_count(self) -> int:
        data = self._get_json(
            _SEARCH,
            {"OC": self._oc, "target": "admrul", "type": "json", "display": 1, "page": 1},
        )
        return int(data.get("AdmRulSearch", {}).get("totalCnt", 0))

    def list_rules(self) -> Iterator[RuleMeta]:
        """현행 행정규칙 전체를 페이징하며 메타를 순차 산출."""
        page = 1
        while True:
            data = self._get_json(
                _SEARCH,
                {"OC": self._oc, "target": "admrul", "type": "json",
                 "display": 100, "page": page},
            )
            rows = data.get("AdmRulSearch", {}).get("admrul", [])
            rows = [rows] if isinstance(rows, dict) else (rows or [])
            if not rows:
                return
            for r in rows:
                yield RuleMeta(
                    rule_id=str(r.get("행정규칙ID") or "").strip(),
                    mst=str(r.get("행정규칙일련번호") or "").strip(),
                    name=str(r.get("행정규칙명") or "").strip(),
                    kind=str(r.get("행정규칙종류") or "").strip(),
                )
            if len(rows) < 100:
                return
            page += 1

    def fetch_body(self, mst: str) -> dict:
        """본문 조회. mst = 행정규칙일련번호 (공식 상세링크의 ID 파라미터)."""
        data = self._get_json(
            _SERVICE,
            {"OC": self._oc, "target": "admrul", "type": "json", "ID": mst},
        )
        if "AdmRulService" not in data:
            # 빈 {} → 소스가 본문을 제공하지 않는 규칙. 재시도 무의미 → 정상 스킵.
            raise EmptyBodyError(f"본문 미제공(ID={mst})")
        return data
