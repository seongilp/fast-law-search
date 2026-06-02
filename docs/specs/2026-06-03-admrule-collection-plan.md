# 행정규칙 수집 + 색인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** law.go.kr OpenAPI에서 현행 행정규칙 전체(~24,052건)를 수집해 기존 법령 markdown 포맷으로 `kr/`에 저장하고, 기존 Typesense 인덱서로 조문 단위 검색이 되게 한다.

**Architecture:** `search/collector/` 신규 패키지. `convert.py`(순수함수: admrul JSON→markdown), `write.py`(경로 충돌 해소+원자적 쓰기), `client.py`(API I/O+throttle+retry), `fetch.py`(오케스트레이션+resume). 데이터는 `kr/{행정규칙명}/{종류}.md`로 저장 → 기존 인덱서 변경 없음.

**Tech Stack:** Python 3.11+, requests, PyYAML, pytest. 기존 `search/indexer` 패턴(frozen dataclass config, 순수 파서) 준수.

---

## File Structure

```
search/collector/
  __init__.py            # 빈 패키지 마커
  config.py              # frozen dataclass, .env 로드 (OC키, ADMRULE_ROOT, 동시성)
  convert.py             # 순수함수: AdmRulService dict → Converted(markdown)
  write.py               # 경로 결정(충돌 해소) + atomic_write
  client.py              # LawApiClient: list_rules(), fetch_body() (requests)
  fetch.py               # CLI main(): 목록→resume판단→본문→변환→저장
  requirements.txt       # requests, PyYAML, python-dotenv, pytest
  tests/
    __init__.py
    fixtures/admrul_sample.json   # 축약 본문 픽스처
    test_convert.py
    test_write.py
search/.env.example       # (수정) LAW_GO_KR_OC, ADMRULE_ROOT 추가
search/Makefile           # (수정) collect 타깃 추가
```

---

## Task 1: 패키지 스캐폴딩 + 설정

**Files:**
- Create: `search/collector/__init__.py` (빈 파일)
- Create: `search/collector/tests/__init__.py` (빈 파일)
- Create: `search/collector/requirements.txt`
- Create: `search/collector/config.py`
- Modify: `search/.env.example`

- [ ] **Step 1: requirements.txt 작성**

Create `search/collector/requirements.txt`:

```
requests==2.32.3
PyYAML==6.0.2
python-dotenv==1.0.1
pytest==8.3.3
```

- [ ] **Step 2: config.py 작성 (기존 indexer/config.py 패턴 동일)**

Create `search/collector/config.py`:

```python
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
```

- [ ] **Step 3: .env.example 에 행정규칙 설정 추가**

Modify `search/.env.example` — 파일 끝에 추가:

```
# 행정규칙 수집기 (collector)
LAW_GO_KR_OC=lawmcp123
ADMRULE_ROOT=../kr
COLLECT_CONCURRENCY=6
COLLECT_RETRY=3
```

- [ ] **Step 4: 커밋**

```bash
cd search && git add collector/__init__.py collector/tests/__init__.py collector/requirements.txt collector/config.py .env.example
git commit -m "feat(collector): 패키지 스캐폴딩 + 설정"
```

---

## Task 2: convert.py — admrul JSON → markdown (순수함수, TDD)

**Files:**
- Create: `search/collector/tests/fixtures/admrul_sample.json`
- Create: `search/collector/tests/test_convert.py`
- Create: `search/collector/convert.py`

- [ ] **Step 1: 픽스처 작성**

Create `search/collector/tests/fixtures/admrul_sample.json` (실제 응답 축약):

```json
{
  "AdmRulService": {
    "행정규칙기본정보": {
      "현행여부": "Y",
      "행정규칙명": "전자금융감독규정",
      "발령일자": "20260213",
      "행정규칙종류": "고시",
      "소관부처명": "금융위원회",
      "제개정구분명": "일부개정",
      "행정규칙ID": "21828",
      "시행일자": "20260213",
      "발령번호": "2026-7",
      "행정규칙일련번호": "2100000274812",
      "조문형식여부": "Y"
    },
    "조문내용": [
      "제1조(목적) 이 규정은 「전자금융거래법」에서 위임한 사항을 규정함을 목적으로 한다.",
      "제1장 총칙",
      "제2조(정의) 이 규정에서 사용하는 용어의 정의는 다음과 같다.",
      "제2장 권리와 의무",
      "제4조 시행령에서 정한 사항을 따른다."
    ],
    "별표": {
      "별표단위": [
        {
          "별표제목": "정보기술부문 인력 산정기준",
          "별표번호": "0001",
          "별표서식PDF파일링크": "/LSW/flDownload.do?flSeq=161734929"
        }
      ]
    },
    "부칙": {
      "부칙내용": [
        "부칙 <제2026-7호,2026. 2. 13.>이 규정은 고시한 날부터 시행한다."
      ]
    }
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `search/collector/tests/test_convert.py`:

```python
import json
from pathlib import Path

from collector.convert import convert

FIX = Path(__file__).parent / "fixtures" / "admrul_sample.json"


def _converted():
    return convert(json.loads(FIX.read_text(encoding="utf-8")))


def test_metadata_extracted():
    c = _converted()
    assert c.name == "전자금융감독규정"
    assert c.kind == "고시"
    assert c.rule_id == "21828"
    assert c.mst == "2100000274812"


def test_frontmatter_fields():
    md = _converted().markdown
    assert md.startswith("---\n")
    assert "제목: 전자금융감독규정" in md
    assert "법령구분: 고시" in md
    assert "공포일자: '2026-02-13'" in md or "공포일자: 2026-02-13" in md
    assert "데이터구분: 행정규칙" in md
    assert "- 금융위원회" in md


def test_article_headers_match_indexer_format():
    md = _converted().markdown
    # 기존 indexer/parse.py _ARTICLE_RE 가 읽는 형식
    assert "##### 제1조 (목적)" in md
    assert "##### 제2조 (정의)" in md
    assert "##### 제4조" in md          # 괄호 없는 조문
    # 구조 헤더 _STRUCT_RE 형식
    assert "## 제1장 총칙" in md
    assert "## 제2장 권리와 의무" in md


def test_body_and_buchik_present():
    md = _converted().markdown
    assert "# 전자금융감독규정" in md
    assert "이 규정은 「전자금융거래법」에서 위임한 사항" in md
    assert "## 부칙" in md
    assert "고시한 날부터 시행" in md


def test_reparses_with_indexer():
    """산출 markdown 을 기존 인덱서 파서로 재파싱해 조문이 추출되는지 (호환성 보장)."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "indexer"))
    import tempfile
    from parse import parse_file  # type: ignore

    c = _converted()
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        f = root / "전자금융감독규정" / "고시.md"
        f.parent.mkdir(parents=True)
        f.write_text(c.markdown, encoding="utf-8")
        meta, arts = parse_file(f, root)
    labels = {a.article_label for a in arts}
    assert {"제1조", "제2조", "제4조"} <= labels
    assert meta["law_type"] == "고시"
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd search && python -m venv .venv-col && .venv-col/bin/pip install -q -r collector/requirements.txt && PYTHONPATH=. .venv-col/bin/pytest collector/tests/test_convert.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'collector.convert'`

- [ ] **Step 4: convert.py 구현**

Create `search/collector/convert.py`:

```python
"""행정규칙 본문(AdmRulService) → 기존 법령 markdown 포맷으로 변환하는 순수함수.

네트워크/파일 I/O 없음. 입력 dict → Converted. 단위 테스트로 검증한다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import yaml

# 가운뎃점 정규화: · (U+00B7) → ㆍ (U+318D) — 기존 저장소 규칙과 동일
_DOT = str.maketrans({"·": "ㆍ"})
_STRUCT = re.compile(r"^(제\d+편|제\d+장|제\d+절|제\d+관)\b")
_ART_PAREN = re.compile(r"^(제\d+조(?:의\d+)?)\s*\((.*?)\)\s*(.*)$", re.DOTALL)
_ART_PLAIN = re.compile(r"^(제\d+조(?:의\d+)?)(?:\s+(.*))?$", re.DOTALL)


@dataclass(frozen=True)
class Converted:
    name: str       # 정규화된 행정규칙명
    kind: str       # 행정규칙종류 (고시/훈령/예규/세칙…)
    rule_id: str    # 행정규칙ID
    mst: str        # 행정규칙일련번호
    markdown: str   # 전체 .md 텍스트


def _norm(s) -> str:
    return str(s or "").translate(_DOT).strip()


def _fmt_date(v) -> str:
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}" if len(digits) >= 8 else ""


def _ministries(v) -> list[str]:
    if not v:
        return []
    items = v if isinstance(v, list) else [v]
    return [_norm(x) for x in items if _norm(x)]


def _as_list(v) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _flatten(v) -> str:
    """문자열 또는 (중첩) 리스트를 한 문자열로."""
    if isinstance(v, list):
        return " ".join(_flatten(x) for x in v)
    return str(v or "")


def _annex_meta(annex) -> list[str]:
    out: list[str] = []
    if isinstance(annex, dict):
        for u in _as_list(annex.get("별표단위")):
            if isinstance(u, dict):
                title = _norm(u.get("별표제목"))
                pdf = str(u.get("별표서식PDF파일링크") or "").strip()
                out.append(f"{title} | {pdf}" if pdf else title)
    return out


def _annex_section(annex) -> list[str]:
    meta = _annex_meta(annex)
    if not meta:
        return []
    out = ["", "## 별표", ""]
    out += [f"- {m}" for m in meta]
    out.append("")
    return out


def _buchik_section(buchik) -> list[str]:
    if not isinstance(buchik, dict):
        return []
    items = [_flatten(x).strip() for x in _as_list(buchik.get("부칙내용"))]
    items = [x for x in items if x]
    if not items:
        return []
    out = ["", "## 부칙", ""]
    for x in items:
        out += [x, ""]
    return out


def _build_body(name: str, svc: dict) -> str:
    out: list[str] = [f"# {name}", ""]
    for raw in _as_list(svc.get("조문내용")):
        line = _flatten(raw).strip()
        if not line:
            continue
        if _STRUCT.match(line):
            out += ["", f"## {line}", ""]
            continue
        m = _ART_PAREN.match(line)
        if m:
            label, title, rest = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
            out += [f"##### {label} ({title})", "", rest, ""]
            continue
        m = _ART_PLAIN.match(line)
        if m and line.startswith("제"):
            label, rest = m.group(1), (m.group(2) or "").strip()
            out += [f"##### {label}", "", rest, ""]
            continue
        out += [line, ""]
    out += _annex_section(svc.get("별표"))
    out += _buchik_section(svc.get("부칙"))
    return "\n".join(out).strip()


def convert(body: dict) -> Converted:
    svc = body.get("AdmRulService", body) if isinstance(body, dict) else {}
    info = svc.get("행정규칙기본정보", {}) or {}

    name = _norm(info.get("행정규칙명"))
    kind = _norm(info.get("행정규칙종류")) or "행정규칙"
    rule_id = str(info.get("행정규칙ID") or "").strip()
    mst = str(info.get("행정규칙일련번호") or "").strip()

    frontmatter = {
        "제목": name,
        "법령MST": mst,
        "법령ID": rule_id,
        "법령구분": kind,
        "소관부처": _ministries(info.get("소관부처명")),
        "공포일자": _fmt_date(info.get("발령일자")),
        "공포번호": str(info.get("발령번호") or "").strip(),
        "시행일자": _fmt_date(info.get("시행일자")),
        "상태": "시행" if str(info.get("현행여부", "")).upper() == "Y" else "폐지",
        "출처": f"https://www.law.go.kr/행정규칙/{name}",
        "데이터구분": "행정규칙",
        "별표": _annex_meta(svc.get("별표")),
    }
    front = yaml.safe_dump(
        frontmatter, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).strip()
    body_md = _build_body(name, svc)
    return Converted(name, kind, rule_id, mst, f"---\n{front}\n---\n\n{body_md}\n")
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd search && PYTHONPATH=. .venv-col/bin/pytest collector/tests/test_convert.py -q`
Expected: PASS (5 passed)

- [ ] **Step 6: 커밋**

```bash
cd search && git add collector/convert.py collector/tests/test_convert.py collector/tests/fixtures/admrul_sample.json
git commit -m "feat(collector): admrul JSON→markdown 순수함수 변환 + 테스트"
```

---

## Task 3: write.py — 경로 충돌 해소 + 원자적 쓰기 (TDD)

**Files:**
- Create: `search/collector/tests/test_write.py`
- Create: `search/collector/write.py`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `search/collector/tests/test_write.py`:

```python
from pathlib import Path

from collector.write import existing_mst, resolve_path, write_markdown


def test_resolve_basic(tmp_path):
    p = resolve_path(tmp_path, "전자금융감독규정", "고시", "21828")
    assert p == tmp_path / "전자금융감독규정" / "고시.md"


def test_resolve_collision_suffixes_rule_id(tmp_path):
    # 같은 경로를 다른 행정규칙ID 가 이미 점유
    d = tmp_path / "전자금융감독규정"
    d.mkdir()
    write_markdown(d / "고시.md", "---\n법령ID: '999'\n---\n# x\n")
    p = resolve_path(tmp_path, "전자금융감독규정", "고시", "21828")
    assert p == d / "고시(21828).md"


def test_resolve_same_rule_reuses_path(tmp_path):
    d = tmp_path / "전자금융감독규정"
    d.mkdir()
    write_markdown(d / "고시.md", "---\n법령ID: '21828'\n---\n# x\n")
    p = resolve_path(tmp_path, "전자금융감독규정", "고시", "21828")
    assert p == d / "고시.md"


def test_existing_mst_reads_frontmatter(tmp_path):
    f = tmp_path / "a.md"
    write_markdown(f, "---\n법령MST: '2100000274812'\n---\n# x\n")
    assert existing_mst(f) == "2100000274812"
    assert existing_mst(tmp_path / "nope.md") == ""


def test_write_is_atomic_and_creates_parents(tmp_path):
    f = tmp_path / "sub" / "b.md"
    write_markdown(f, "hello")
    assert f.read_text(encoding="utf-8") == "hello"
    assert not list(tmp_path.glob("**/*.tmp"))  # 임시파일 잔존 없음
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd search && PYTHONPATH=. .venv-col/bin/pytest collector/tests/test_write.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'collector.write'`

- [ ] **Step 3: write.py 구현**

Create `search/collector/write.py`:

```python
"""행정규칙 markdown 파일 경로 결정(충돌 해소) + 원자적 쓰기. 파일 I/O 전담."""
from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _dir_name(name: str) -> str:
    """행정규칙명 → 디렉터리명(공백 제거). law.go.kr URL 규칙과 동일."""
    return re.sub(r"\s+", "", name)


def _frontmatter(path: Path) -> dict:
    if not path.exists():
        return {}
    m = _FRONT.match(path.read_text(encoding="utf-8"))
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1)) or {}
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


def existing_mst(path: Path) -> str:
    return str(_frontmatter(path).get("법령MST") or "").strip()


def resolve_path(root: Path, name: str, kind: str, rule_id: str) -> Path:
    """`root/{명}/{종류}.md`. 다른 행정규칙ID 가 이미 점유 시 `{종류}({ID}).md`."""
    d = root / _dir_name(name)
    base = d / f"{kind}.md"
    if not base.exists():
        return base
    if str(_frontmatter(base).get("법령ID") or "").strip() == str(rule_id).strip():
        return base
    return d / f"{kind}({rule_id}).md"


def write_markdown(path: Path, content: str) -> None:
    """임시파일 → rename 으로 원자적 쓰기. 부분 파일 방지."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd search && PYTHONPATH=. .venv-col/bin/pytest collector/tests/test_write.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
cd search && git add collector/write.py collector/tests/test_write.py
git commit -m "feat(collector): 파일 경로 충돌 해소 + 원자적 쓰기 + 테스트"
```

---

## Task 4: client.py — law.go.kr API 클라이언트 (throttle + retry)

**Files:**
- Create: `search/collector/client.py`

- [ ] **Step 1: client.py 구현**

Create `search/collector/client.py`:

```python
"""law.go.kr OpenAPI 클라이언트. 네트워크 I/O + throttle + retry 전담.

목록: lawSearch.do?target=admrul (display=100, 페이징)
본문: lawService.do?target=admrul&LID={행정규칙ID}   (★ LID 만 동작)
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
    pass


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

    def fetch_body(self, rule_id: str) -> dict:
        data = self._get_json(
            _SERVICE,
            {"OC": self._oc, "target": "admrul", "type": "json", "LID": rule_id},
        )
        if "AdmRulService" not in data:
            raise LawApiError(f"본문 없음(LID={rule_id}): {str(data)[:80]}")
        return data
```

- [ ] **Step 2: import 스모크 (네트워크 없이)**

Run: `cd search && PYTHONPATH=. .venv-col/bin/python -c "from collector.client import LawApiClient, RuleMeta; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
cd search && git add collector/client.py
git commit -m "feat(collector): law.go.kr API 클라이언트 (throttle+retry)"
```

---

## Task 5: fetch.py — 오케스트레이션 CLI (resume + 병렬 + 진행률)

**Files:**
- Create: `search/collector/fetch.py`

- [ ] **Step 1: fetch.py 구현**

Create `search/collector/fetch.py`:

```python
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
    for i, m in enumerate(client.list_rules(), 1):
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
```

- [ ] **Step 2: import 스모크**

Run: `cd search && PYTHONPATH=. .venv-col/bin/python -c "from collector import fetch; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
cd search && git add collector/fetch.py
git commit -m "feat(collector): 수집 오케스트레이션 CLI (resume+병렬+진행률)"
```

---

## Task 6: Makefile 타깃 + 통합 스모크 + 색인 검증

**Files:**
- Modify: `search/Makefile`

- [ ] **Step 1: Makefile 에 collect 타깃 추가**

Modify `search/Makefile` — `venv:` 타깃 아래에 추가하고, `help` 출력에도 한 줄 추가:

```makefile
col-venv:
	python3 -m venv .venv-col
	.venv-col/bin/pip install -q -r collector/requirements.txt
	@echo "[ok] .venv-col 준비 완료"

collect: col-venv
	PYTHONPATH=. .venv-col/bin/python -m collector.fetch

collect-smoke: col-venv
	PYTHONPATH=. .venv-col/bin/python -m collector.fetch --limit 5
```

`help:` 의 echo 목록에 추가:

```makefile
	@echo "  make collect   행정규칙 전량 수집 → kr/ (변경분만)"
	@echo "  make collect-smoke  행정규칙 5건만 수집(스모크)"
```

- [ ] **Step 2: 전체 단위 테스트 통과 확인**

Run: `cd search && PYTHONPATH=. .venv-col/bin/pytest collector/tests -q`
Expected: PASS (10 passed)

- [ ] **Step 3: 실제 5건 통합 스모크 (네트워크)**

Run: `cd search && make collect-smoke`
Expected: `[done] 처리 5 → 저장 5, 스킵 0, 실패 0` (재실행 시 `스킵 5`)

검증: `ls ../kr/전자금융감독규정/ 2>/dev/null` 또는 수집된 디렉터리에 `{종류}.md` 존재 확인. frontmatter 에 `데이터구분: 행정규칙` 포함 확인:
`grep -l "데이터구분: 행정규칙" ../kr/*/*.md | head`

- [ ] **Step 4: 색인 + 검색 검증**

Run: `cd search && make up && make reindex`
그 후 행정규칙 본문 단어로 검색되는지 확인 (Typesense 직접 질의):

```bash
curl -s "http://localhost:8108/collections/kr_laws/documents/search?q=전산실&query_by=content&filter_by=law_type:=고시&per_page=3" \
  -H "X-TYPESENSE-API-KEY: $(grep TYPESENSE_API_KEY .env | cut -d= -f2)" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('found:', d.get('found')); [print(' -', h['document']['law_name'], h['document']['article_label']) for h in d.get('hits',[])]"
```

Expected: `found` > 0, 고시 law_type 의 행정규칙 조문이 반환됨.

- [ ] **Step 5: 커밋**

```bash
cd search && git add Makefile && git commit -m "feat(collector): make collect 타깃 + 색인 통합"
```

- [ ] **Step 6: (선택) 전량 수집 실행**

스모크가 통과하면 전량 수집:

Run: `cd search && make collect && make reindex`
Expected: ~24,000건 저장. ⚠️ 시간 소요(동시성 6, ~20–40분). 중단해도 재실행 시 resume.

> **upstream push 금지**: `kr/` 변경은 커밋/푸시하지 않는다. 로컬 검색 인덱스용으로만 보관.

---

## Self-Review

**Spec coverage:**
- §3 API 계약 → Task 4 client.py (list/fetch, LID, 페이징, dict 정규화) ✅
- §4 컴포넌트 분리 → Task 1–5 (config/convert/write/client/fetch) ✅
- §5 변환 규칙(frontmatter·조문·구조헤더·부칙·정규화) → Task 2 convert.py + 테스트 ✅
- §6 경로 충돌 해소 → Task 3 write.py + 테스트 ✅
- §7 멱등성(resume·격리·진행률·throttle·retry) → Task 4(throttle/retry) + Task 5(resume/격리/진행률) ✅
- §9 Makefile 2단계 → Task 6 ✅
- §10 테스트 전략(convert 순수함수·write 충돌·재파싱 호환·색인 검증) → Task 2/3/6 ✅
- §2 kr/ 직접 저장·인덱서 변경 0·upstream 미푸시 → ADMRULE_ROOT=../kr, indexer 무변경, Task 6 Step 6 경고 ✅

**Placeholder scan:** 모든 코드/명령/기대출력 구체화됨. "적절히 처리" 류 없음. ✅

**Type consistency:** `Converted(name,kind,rule_id,mst,markdown)`, `RuleMeta(rule_id,mst,name,kind)`, `resolve_path(root,name,kind,rule_id)`, `existing_mst(path)`, `write_markdown(path,content)` — Task 간 시그니처 일치 확인. `convert()` 입력은 `{"AdmRulService":...}` 전체 dict(클라이언트 `fetch_body` 반환과 동일). ✅

**범위 밖(v2):** 연혁 수집, 항/호 정형화, 별표 본문 색인, 자동 스케줄러, git 자동화 — 스펙 §11과 일치. ✅
```
