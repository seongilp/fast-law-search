"""_process 분류 로직 단위 테스트 (네트워크 없이 가짜 클라이언트 사용)."""
import json
from pathlib import Path

from collector.client import EmptyBodyError, LawApiError, RuleMeta
from collector.config import CollectorConfig
from collector.fetch import _process

FIX = Path(__file__).parent / "fixtures" / "admrul_sample.json"


def _cfg(tmp_path) -> CollectorConfig:
    return CollectorConfig(oc="x", admrule_root=tmp_path, concurrency=1, retry=1)


class _FakeClient:
    def __init__(self, behavior):
        self._behavior = behavior

    def fetch_body(self, mst):
        if self._behavior == "empty":
            raise EmptyBodyError(f"본문 미제공(ID={mst})")
        if self._behavior == "fail":
            raise LawApiError("HTTP 500")
        return json.loads(FIX.read_text(encoding="utf-8"))


def _meta():
    return RuleMeta(rule_id="21828", mst="2100000274812", name="전자금융감독규정", kind="고시")


def test_process_writes_on_ok(tmp_path):
    r = _process(_FakeClient("ok"), _cfg(tmp_path), _meta())
    assert r == "write"
    assert (tmp_path / "전자금융감독규정" / "고시.md").exists()


def test_process_classifies_empty(tmp_path):
    r = _process(_FakeClient("empty"), _cfg(tmp_path), _meta())
    assert r == "empty"
    assert not (tmp_path / "전자금융감독규정").exists()  # 파일 생성 안 함


def test_process_classifies_fail(tmp_path):
    r = _process(_FakeClient("fail"), _cfg(tmp_path), _meta())
    assert r == "fail"


def test_process_resumes_on_same_mst(tmp_path):
    # 먼저 한 번 써두고, 같은 MST 면 fetch 없이 skip
    _process(_FakeClient("ok"), _cfg(tmp_path), _meta())

    class _Boom:
        def fetch_body(self, mst):
            raise AssertionError("resume 시 fetch_body 호출되면 안 됨")

    r = _process(_Boom(), _cfg(tmp_path), _meta())
    assert r == "skip"
