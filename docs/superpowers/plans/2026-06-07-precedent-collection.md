# 판례(대법원) 수집·저장·검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대법원 판례(약 75,211건)를 law.go.kr OpenAPI에서 수집해 `prec/` 디렉터리에 불변 마크다운으로 저장하고, 별도 Typesense 컬렉션 + 통합 UI(법령/판례 탭)로 검색 가능하게 만든다.

**Architecture:** 기존 `search/collector/`(행정규칙 수집기)와 `search/indexer/`(조문 인덱서) 패턴을 그대로 복제한다. 신규 `search/collector_prec/`가 목록 페이징 → 본문 조회 → 마크다운 변환 → 원자적 쓰기를 수행하고, `search/collector_prec/commit.py`가 각 판례를 선고일자 커밋으로 남긴다(1판례=1커밋, 불변). `search/indexer/`에 판례 전용 파서·스키마·인덱서를 추가해 `kr_precedents` 컬렉션을 만들고, `search/ui/`에 법령↔판례 탭과 판례 어댑터·카드를 추가한다.

**Tech Stack:** Python 3.13 (requests, pyyaml, pytest), Typesense, Vite + React + TypeScript + react-instantsearch + typesense-instantsearch-adapter.

**전제(이미 확인된 API 사실):**
- 목록: `GET https://www.law.go.kr/DRF/lawSearch.do?OC={oc}&target=prec&type=JSON&org=400201&display=100&page=N`
  → `PrecSearch.prec[]` 각 행: `판례일련번호, 사건명, 사건번호, 선고일자, 법원명, 법원종류코드, 사건종류명, 사건종류코드, 판결유형, 선고, 데이터출처명, 판례상세링크`. `PrecSearch.totalCnt`=75211. (목록 `사건번호`는 `대법원-2025-두-34754`처럼 대시 표기)
- 본문: `GET https://www.law.go.kr/DRF/lawService.do?OC={oc}&target=prec&type=JSON&ID={판례일련번호}`
  → `PrecService`: `판시사항, 판결요지, 참조조문, 참조판례, 판례내용`(모두 `<br/>` 포함 HTML), `사건명, 사건번호`(정제형 `2021도3451`), `선고일자`(`20220819`), `법원명, 법원종류코드, 사건종류명, 사건종류코드, 판결유형, 선고, 판례정보일련번호`.
- 국세법령정보시스템 출처 판례는 JSON 본문을 제공하지 않음(HTML 전용) → `PrecService` 키 없음 → 정상 스킵(`EmptyBodyError` 패턴).

---

## File Structure

신규/수정 파일과 책임:

```
search/
  collector_prec/
    __init__.py
    config.py        # PREC_ROOT(../prec), LAW_GO_KR_OC, concurrency, retry 로딩
    client.py        # 목록 페이징 + 본문 조회 (target=prec, org=400201)
    convert.py       # PrecService dict → 판례 마크다운 (순수함수, TDD)
    write.py         # 연도/사건번호/일련번호 경로 결정 + resume 인덱스 + 원자적 쓰기 (TDD)
    fetch.py         # 오케스트레이션 (목록→resume 스킵→본문→convert→write)
    commit.py        # 신규 prec/*.md 를 선고일자 author date 로 1건씩 커밋
    requirements.txt
    tests/
      __init__.py
      fixtures/prec_service_sample.json   # 실제 본문 응답 1건
      test_convert.py
      test_write.py
  indexer/
    config_prec.py   # PREC_ROOT(../prec), PREC_COLLECTION(kr_precedents) 로딩
    parse_prec.py    # prec/*.md → (메타, 판례 도큐먼트) 파서 (순수함수, TDD)
    schema_prec.py   # precedents 컬렉션 스키마
    index_prec.py    # prec/ 전량 색인 CLI (--keep / --alias)
    tests/test_parse_prec.py
  ui/src/
    lib/typesense.ts          # (수정) PREC_COLLECTION + precSearchClient + PrecHit 타입
    components/PrecedentHitCard.tsx  # (신규) 판례 결과 카드
    components/ModeTabs.tsx          # (신규) 법령/판례 토글 탭
    App.tsx                          # (수정) mode 상태 → InstantSearch 컬렉션/어댑터 전환
prec/                # 신규 데이터 루트 (수집 결과)
docs/superpowers/specs/2026-06-07-precedent-collection-design.md  # 스펙(이미 작성됨)
README.md           # (수정) prec/ 구조 문서화
search/README.md    # (수정) 판례 인덱싱/검색 문서화
```

설계 원칙: 법령용 모듈(`collector/`, `indexer/index.py` 등)은 **수정하지 않고** 판례용을 병렬로 추가한다(저위험·낮은 결합). UI만 mode 전환을 위해 기존 파일을 수정한다.

---

## ⚠️ 저장소 경계 (CRITICAL — 모든 커밋 명령에 우선)

이 작업트리에는 **서로 다른 두 개의 git 저장소**가 중첩되어 있다:

| 저장소 | 루트 | 원격 | 담당 파일 |
|--------|------|------|-----------|
| **search 코드** | `search/` | `seongilp/fast-law-search` | `search/**` 전부 (collector_prec, indexer, ui, Makefile, .env.example, search/README.md) |
| **법령/판례 데이터** | `law.zihado.com/` (루트) | `legalize-kr/legalize-kr` | `prec/**`, 루트 `README.md`, `.github/**`, `docs/**` |

**커밋 규칙(아래 각 Task의 commit 블록을 이 규칙으로 해석할 것):**
- `search/**` 변경(=대부분의 코드 Task 1~13)은 **반드시 `cd search` 후** `git add <search 기준 상대경로>` + `git commit` 한다. (예: `cd search && git add collector_prec/convert.py && git commit ...`) — 루트에서 `git add search/...` 하면 안 된다(루트 repo는 `search/`를 nested repo로 취급).
- `prec/**`·루트 `README.md`·`.github/**`·`docs/**` 변경(Task 14·15(루트 README)·16)은 **루트(`law.zihado.com`)에서** 커밋한다.
- Task 15는 둘로 나뉜다: 루트 `README.md` → 루트 repo / `search/README.md` → search repo.
- `collector_prec/commit.py`는 search repo의 코드지만, 동작 시 **루트 repo의 `prec/`** 파일을 선고일자 커밋으로 기록한다(`_REPO`가 루트를 가리킴). 정상 의도다.
- **푸시(push)는 어느 repo든 사용자 확인 전까지 하지 않는다.** 두 repo 모두 로컬 main에서 작업(되돌릴 수 있음).

---

## Phase 1 — 수집기 (collector_prec)

### Task 1: 패키지 골격 + config

**Files:**
- Create: `search/collector_prec/__init__.py`
- Create: `search/collector_prec/requirements.txt`
- Create: `search/collector_prec/config.py`
- Create: `search/collector_prec/tests/__init__.py`

- [ ] **Step 1: 빈 패키지 파일 생성**

`search/collector_prec/__init__.py` → 빈 파일.
`search/collector_prec/tests/__init__.py` → 빈 파일.

- [ ] **Step 2: requirements.txt 작성**

`search/collector_prec/requirements.txt`:
```
requests>=2.31
python-dotenv>=1.0
PyYAML>=6.0
pytest>=8.0
```

- [ ] **Step 3: config.py 작성** (기존 `collector/config.py` 미러)

`search/collector_prec/config.py`:
```python
"""판례 수집기 설정. 모든 값은 .env/환경변수에서 읽는다(하드코딩 금지)."""
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
    prec_root: Path
    concurrency: int
    retry: int

    @staticmethod
    def from_env() -> "CollectorConfig":
        root = os.environ.get("PREC_ROOT", "../prec")
        base = Path(__file__).resolve().parent.parent
        prec_root = (base / root).resolve() if not os.path.isabs(root) else Path(root)
        prec_root.mkdir(parents=True, exist_ok=True)
        return CollectorConfig(
            oc=os.environ.get("LAW_GO_KR_OC", ""),
            prec_root=prec_root,
            concurrency=int(os.environ.get("COLLECT_CONCURRENCY", "6")),
            retry=int(os.environ.get("COLLECT_RETRY", "3")),
        )
```

- [ ] **Step 4: import 스모크**

Run: `cd search && python -c "from collector_prec.config import CollectorConfig; print(CollectorConfig.from_env().prec_root)"`
Expected: `prec/` 절대경로 출력, 에러 없음.

- [ ] **Step 5: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/collector_prec/__init__.py search/collector_prec/tests/__init__.py search/collector_prec/requirements.txt search/collector_prec/config.py
git commit -m "feat(prec): 판례 수집기 패키지 골격 + config"
```

---

### Task 2: convert.py — 본문 dict → 마크다운 (TDD)

**Files:**
- Create: `search/collector_prec/tests/fixtures/prec_service_sample.json`
- Test: `search/collector_prec/tests/test_convert.py`
- Create: `search/collector_prec/convert.py`

- [ ] **Step 1: 실제 본문 응답 fixture 저장**

Run (실제 API에서 1건 받아 fixture로 저장):
```bash
cd /Users/zihado/work/playground/law.zihado.com/search
OC=$(grep '^LAW_GO_KR_OC=' .env | cut -d= -f2)
mkdir -p collector_prec/tests/fixtures
curl -s "https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&type=JSON&ID=228541" \
  -o collector_prec/tests/fixtures/prec_service_sample.json
python -c "import json;d=json.load(open('collector_prec/tests/fixtures/prec_service_sample.json'));print(list(d['PrecService'].keys()))"
```
Expected: `['판시사항', '참조판례', '사건종류명', '판결요지', '참조조문', '선고일자', '법원명', '사건명', '판례내용', '사건번호', '사건종류코드', '판례정보일련번호', '선고', '판결유형', '법원종류코드']`

- [ ] **Step 2: 실패 테스트 작성**

`search/collector_prec/tests/test_convert.py`:
```python
import json
from pathlib import Path

from collector_prec.convert import convert

FIXTURE = Path(__file__).parent / "fixtures" / "prec_service_sample.json"


def _load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_convert_metadata():
    c = convert(_load())
    assert c.serial == "228541"
    assert c.case_no == "2021도3451"
    assert c.decided_date == "2022-08-19"
    assert c.case_name == "강제추행"


def test_convert_frontmatter_and_sections():
    md = convert(_load()).markdown
    assert md.startswith("---\n")
    assert "제목: 강제추행" in md
    assert '판례일련번호: "228541"' in md
    assert "사건번호: 2021도3451" in md
    assert "선고일자: 2022-08-19" in md
    assert "법원명: 대법원" in md
    assert "상태: 시행" in md
    # 본문 섹션 헤더
    assert "## 판시사항" in md
    assert "## 판결요지" in md
    assert "## 참조조문" in md
    assert "## 참조판례" in md
    assert "## 판례내용" in md
    # <br/> 는 줄바꿈으로 치환되어 본문에 남지 않는다
    assert "<br/>" not in md and "<br>" not in md


def test_convert_handles_missing_service_key():
    # 국세 등 본문 미제공 → 빈 dict 들어오면 ValueError(상위에서 EmptyBody 처리)
    import pytest
    with pytest.raises(ValueError):
        convert({})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd search && python -m pytest collector_prec/tests/test_convert.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'collector_prec.convert'`

- [ ] **Step 4: convert.py 구현**

`search/collector_prec/convert.py`:
```python
"""판례 본문(PrecService) → 판례 markdown 으로 변환하는 순수함수.

네트워크/파일 I/O 없음. 입력 dict → Converted. 단위 테스트로 검증한다.
법령 collector/convert.py 와 동일한 가운뎃점 정규화 규칙을 따른다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import yaml

_DOT = str.maketrans({"·": "ㆍ"})          # · (U+00B7) → ㆍ (U+318D)
_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Converted:
    serial: str        # 판례정보일련번호
    case_no: str       # 사건번호(정제형)
    decided_date: str  # YYYY-MM-DD
    case_name: str     # 사건명
    markdown: str      # 전체 .md 텍스트


def _norm(s) -> str:
    return str(s or "").translate(_DOT).strip()


def _fmt_date(v) -> str:
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}" if len(digits) >= 8 else ""


def _clean(v) -> str:
    """<br/> → 줄바꿈, 잔여 태그 제거, 가운뎃점 정규화, 양끝 공백 정리."""
    s = _BR.sub("\n", str(v or ""))
    s = _TAG.sub("", s)
    s = s.translate(_DOT)
    lines = [ln.strip() for ln in s.splitlines()]
    return "\n".join(lines).strip()


def _refs(v) -> list[str]:
    """참조조문/참조판례 문자열 → 리스트. '/' 와 ',' 로 분리."""
    text = _clean(v)
    if not text:
        return []
    parts = re.split(r"[/\n]", text)
    out: list[str] = []
    for p in parts:
        p = p.strip(" .")
        if p:
            out.append(p)
    return out


def _section(title: str, value) -> list[str]:
    text = _clean(value)
    if not text:
        return []
    return ["", f"## {title}", "", text]


def convert(body: dict) -> Converted:
    svc = body.get("PrecService") if isinstance(body, dict) else None
    if not isinstance(svc, dict) or not svc:
        raise ValueError("PrecService 본문이 없습니다(미제공 판례)")

    serial = str(svc.get("판례정보일련번호") or "").strip()
    case_no = _norm(svc.get("사건번호"))
    case_name = _norm(svc.get("사건명")) or case_no
    decided = _fmt_date(svc.get("선고일자"))

    frontmatter = {
        "제목": case_name,
        "판례일련번호": serial,
        "사건번호": case_no,
        "법원명": _norm(svc.get("법원명")),
        "법원종류코드": str(svc.get("법원종류코드") or "").strip(),
        "사건종류명": _norm(svc.get("사건종류명")),
        "사건종류코드": str(svc.get("사건종류코드") or "").strip(),
        "판결유형": _norm(svc.get("판결유형")),
        "선고": _norm(svc.get("선고")),
        "선고일자": decided,
        "참조조문": _refs(svc.get("참조조문")),
        "참조판례": _refs(svc.get("참조판례")),
        "상태": "시행",
        "출처": f"https://www.law.go.kr/판례/({serial})",
        "데이터구분": "판례",
    }
    # 빈 리스트 키는 제거(노이즈 방지)
    frontmatter = {k: v for k, v in frontmatter.items() if not (isinstance(v, list) and not v)}

    front = yaml.safe_dump(
        frontmatter, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).strip()

    body_lines: list[str] = [f"# {case_name}"]
    body_lines += _section("판시사항", svc.get("판시사항"))
    body_lines += _section("판결요지", svc.get("판결요지"))
    body_lines += _section("참조조문", svc.get("참조조문"))
    body_lines += _section("참조판례", svc.get("참조판례"))
    body_lines += _section("판례내용", svc.get("판례내용"))
    body_md = "\n".join(body_lines).strip()

    return Converted(serial, case_no, decided, case_name, f"---\n{front}\n---\n\n{body_md}\n")
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd search && python -m pytest collector_prec/tests/test_convert.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/collector_prec/convert.py search/collector_prec/tests/test_convert.py search/collector_prec/tests/fixtures/prec_service_sample.json
git commit -m "feat(prec): 본문 dict→마크다운 변환 convert + 테스트"
```

---

### Task 3: write.py — 경로 결정 + resume 인덱스 + 원자적 쓰기 (TDD)

**Files:**
- Test: `search/collector_prec/tests/test_write.py`
- Create: `search/collector_prec/write.py`

- [ ] **Step 1: 실패 테스트 작성**

`search/collector_prec/tests/test_write.py`:
```python
from pathlib import Path

from collector_prec.write import resolve_path, existing_serials, write_markdown


def test_resolve_path_year_shard(tmp_path: Path):
    p = resolve_path(tmp_path, case_no="2021도3451", decided_date="2022-08-19", serial="228541")
    assert p == tmp_path / "2022" / "2021도3451(228541).md"


def test_resolve_path_sanitizes_slash_and_space(tmp_path: Path):
    p = resolve_path(tmp_path, case_no="2021다100, 2021다101", decided_date="2020-01-02", serial="9")
    # 슬래시 제거·공백 제거, 쉼표는 유지
    assert p == tmp_path / "2020" / "2021다100,2021다101(9).md"


def test_resolve_path_no_date_uses_unknown_year(tmp_path: Path):
    p = resolve_path(tmp_path, case_no="2021도1", decided_date="", serial="5")
    assert p == tmp_path / "unknown" / "2021도1(5).md"


def test_existing_serials_scans_parenthesized_ids(tmp_path: Path):
    (tmp_path / "2022").mkdir()
    (tmp_path / "2022" / "2021도3451(228541).md").write_text("x", encoding="utf-8")
    (tmp_path / "2020").mkdir()
    (tmp_path / "2020" / "2019두1(100).md").write_text("x", encoding="utf-8")
    assert existing_serials(tmp_path) == {"228541", "100"}


def test_write_markdown_atomic(tmp_path: Path):
    target = tmp_path / "2022" / "a(1).md"
    write_markdown(target, "hello")
    assert target.read_text(encoding="utf-8") == "hello"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd search && python -m pytest collector_prec/tests/test_write.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'collector_prec.write'`

- [ ] **Step 3: write.py 구현**

`search/collector_prec/write.py`:
```python
"""판례 markdown 경로 결정 + resume 인덱스 + 원자적 쓰기. 파일 I/O 전담."""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

_DOT = str.maketrans({"·": "ㆍ"})
_SERIAL_IN_NAME = re.compile(r"\((\d+)\)\.md$")


def _year(decided_date: str) -> str:
    d = "".join(ch for ch in str(decided_date or "") if ch.isdigit())
    return d[:4] if len(d) >= 4 else "unknown"


def _safe(case_no: str) -> str:
    """사건번호 → 파일명 안전화: 가운뎃점 정규화 + 슬래시 제거 + 공백 제거."""
    s = str(case_no or "").translate(_DOT).replace("/", "")
    return re.sub(r"\s+", "", s)


def resolve_path(root: Path, case_no: str, decided_date: str, serial: str) -> Path:
    """`root/{선고연도}/{사건번호}({판례일련번호}).md`."""
    return root / _year(decided_date) / f"{_safe(case_no)}({serial}).md"


def existing_serials(root: Path) -> set[str]:
    """이미 저장된 모든 판례일련번호 집합. resume(불변 스킵)용."""
    out: set[str] = set()
    if not root.is_dir():
        return out
    for p in root.rglob("*.md"):
        m = _SERIAL_IN_NAME.search(p.name)
        if m:
            out.add(m.group(1))
    return out


def write_markdown(path: Path, content: str) -> None:
    """고유 임시파일 → rename 으로 원자적 쓰기. 부분 파일 방지."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_name, path)
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd search && python -m pytest collector_prec/tests/test_write.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/collector_prec/write.py search/collector_prec/tests/test_write.py
git commit -m "feat(prec): 경로 결정 + resume 인덱스 + 원자적 쓰기 write + 테스트"
```

---

### Task 4: client.py — 목록 페이징 + 본문 조회

**Files:**
- Create: `search/collector_prec/client.py`

- [ ] **Step 1: client.py 구현** (기존 `collector/client.py` 미러, target=prec)

`search/collector_prec/client.py`:
```python
"""law.go.kr OpenAPI 판례 클라이언트. 네트워크 I/O + throttle + retry 전담.

목록: lawSearch.do?target=prec&org=400201 (display=100, 페이징)
본문: lawService.do?target=prec&ID={판례일련번호}
"""
from __future__ import annotations

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
```

- [ ] **Step 2: 라이브 스모크 (목록 1페이지 + 본문 1건)**

Run:
```bash
cd search && python -c "
from collector_prec.config import CollectorConfig
from collector_prec.client import PrecApiClient
cfg = CollectorConfig.from_env()
c = PrecApiClient(cfg.oc)
print('total:', c.total_count())
m = next(c.list_precedents())
print('first:', m.serial, m.case_name[:20])
body = c.fetch_body(m.serial)
print('has PrecService:', 'PrecService' in body)
"
```
Expected: `total: 75211`(±), 첫 메타 출력, 본문 존재 여부 출력(미제공이면 EmptyBodyError 발생 가능 — 정상).

- [ ] **Step 3: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/collector_prec/client.py
git commit -m "feat(prec): 목록 페이징 + 본문 조회 API 클라이언트"
```

---

### Task 5: fetch.py — 오케스트레이션

**Files:**
- Create: `search/collector_prec/fetch.py`

- [ ] **Step 1: fetch.py 구현** (기존 `collector/fetch.py` 미러, resume=set 기반)

`search/collector_prec/fetch.py`:
```python
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
```

- [ ] **Step 2: 스모크 수집(5건)**

Run: `cd search && python -m collector_prec.fetch --limit 5`
Expected: `[done] 처리 5 → 저장 N, 본문미제공 M, 실패 0`. `prec/` 아래 `{연도}/{사건번호}(일련번호).md` 파일 생성.

- [ ] **Step 3: 결과 파일 육안 확인**

Run: `cd /Users/zihado/work/playground/law.zihado.com && find prec -name '*.md' | head -3 && echo '---' && head -25 "$(find prec -name '*.md' | head -1)"`
Expected: frontmatter(제목/판례일련번호/사건번호/선고일자/법원명/상태) + `## 판시사항` 등 섹션 확인.

- [ ] **Step 4: resume 재실행이 스킵하는지 확인**

Run: `cd search && python -m collector_prec.fetch --limit 5`
Expected: `[list] 신규 메타 0건` (이미 저장된 건 스킵) 또는 다음 신규 건만 처리.

- [ ] **Step 5: Commit (코드만, prec/ 데이터는 Task 6 commit.py 로 별도 커밋)**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/collector_prec/fetch.py
git commit -m "feat(prec): 판례 전량 수집 오케스트레이션 fetch"
```

---

### Task 6: commit.py — 배치(단일) 커밋

> **변경(2026-06-07):** 당초 "1판례=1커밋(선고일자)" 모델이었으나, 7만여 건을 파일마다
> 커밋하면 history가 비대해지고 느려서 **한 수집 = 한 커밋(배치)** 으로 바꿨다.
> 선고일자/사건번호는 각 파일 frontmatter가 진실의 원천이라 커밋 날짜로 분리할 필요가 없다.

**Files:**
- Create: `search/collector_prec/commit.py`

- [ ] **Step 1: commit.py 구현**

prec/ 아래 미커밋(.md) 전체를 단일 커밋으로 묶는다. `git add -- prec` 후 `git commit -- prec`. 메시지에 추가 건수만 표기.

`search/collector_prec/commit.py`:
```python
"""prec/ 의 신규(미추적/수정) 판례 .md 를 선고일자 커밋으로 1건씩 기록한다.

판례는 불변 → 1판례=1커밋. author/committer date = 선고일자.
Git 은 1970-01-01 이전을 지원하지 않으므로 epoch 로 클램프(frontmatter 가 진실).

사용:
    python -m collector_prec.commit            # prec/ 미커밋 파일 전부 커밋
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_REPO = Path(__file__).resolve().parent.parent.parent     # law.zihado.com 루트
_PREC = _REPO / "prec"


def _field(text: str, key: str) -> str:
    m = _FRONT.match(text)
    block = m.group(1) if m else ""
    fm = re.search(rf"^{key}:\s*(.+)$", block, re.MULTILINE)
    return fm.group(1).strip().strip('"') if fm else ""


def _git(args: list[str], env: dict | None = None) -> str:
    out = subprocess.run(
        ["git", "-C", str(_REPO), *args],
        check=True, capture_output=True, text=True,
        env={**os.environ, **(env or {})},
    )
    return out.stdout.strip()


def _pending() -> list[str]:
    """prec/ 아래 미추적 + 수정된 .md 경로(레포 상대)."""
    status = _git(["status", "--porcelain", "--", "prec"])
    paths: list[str] = []
    for line in status.splitlines():
        path = line[3:].strip().strip('"')
        if path.endswith(".md"):
            paths.append(path)
    return sorted(paths)


def _commit_one(rel_path: str) -> None:
    text = (_REPO / rel_path).read_text(encoding="utf-8")
    name = _field(text, "제목") or "판례"
    case_no = _field(text, "사건번호")
    case_type = _field(text, "사건종류명")
    jtype = _field(text, "판결유형")
    serial = _field(text, "판례일련번호")
    decided = _field(text, "선고일자")  # YYYY-MM-DD

    # Git 은 epoch 이전 날짜 미지원 → 클램프
    date_iso = f"{decided}T00:00:00" if decided and decided >= "1970-01-01" else "1970-01-01T00:00:00"

    subject = f"판례: {name} [대법원 {case_no}]"
    bodylines = [
        f"선고일자: {decided} | 사건종류: {case_type} | 판결유형: {jtype}",
        f"판례일련번호: {serial}",
        f"출처: https://www.law.go.kr/판례/({serial})",
    ]
    message = subject + "\n\n" + "\n".join(bodylines) + "\n"

    _git(["add", "--", rel_path])
    env = {"GIT_AUTHOR_DATE": date_iso, "GIT_COMMITTER_DATE": date_iso}
    _git(["commit", "-q", "-m", message, "--", rel_path], env=env)


def main() -> int:
    pending = _pending()
    if not pending:
        print("[commit] 커밋할 판례 없음")
        return 0
    print(f"[commit] 대상 {len(pending)}건")
    for i, rel in enumerate(pending, 1):
        try:
            _commit_one(rel)
        except subprocess.CalledProcessError as exc:
            print(f"  [fail] {rel}: {exc.stderr}", file=sys.stderr)
        if i % 200 == 0:
            print(f"  [progress] {i}/{len(pending)}")
    print(f"[done] 커밋 완료 {len(pending)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 스모크 — Task 5에서 수집된 prec/ 파일 커밋**

Run: `cd search && python -m collector_prec.commit`
Expected: `[done] 커밋 완료 N건`.

- [ ] **Step 3: 커밋 날짜·메시지 확인**

Run: `cd /Users/zihado/work/playground/law.zihado.com && git log -3 --date=short --format='%ad %s' -- prec`
Expected: 각 커밋의 날짜가 해당 판례 선고일자(또는 1970-01-01)와 일치, 제목 `판례: ... [대법원 ...]`.

- [ ] **Step 4: commit.py 자체 커밋**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/collector_prec/commit.py
git commit -m "feat(prec): 선고일자 기준 1판례=1커밋 commit"
```

---

## Phase 2 — 인덱서 (precedents 컬렉션)

### Task 7: config_prec.py + schema_prec.py

**Files:**
- Create: `search/indexer/config_prec.py`
- Create: `search/indexer/schema_prec.py`

- [ ] **Step 1: config_prec.py 작성** (기존 `indexer/config.py` 미러)

`search/indexer/config_prec.py`:
```python
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
```

- [ ] **Step 2: schema_prec.py 작성**

`search/indexer/schema_prec.py`:
```python
"""판례 Typesense 컬렉션 스키마. 한국어 locale 'ko' 토크나이저 사용."""
from __future__ import annotations


def collection_schema(name: str) -> dict:
    return {
        "name": name,
        "default_sorting_field": "decided_date",
        "token_separators": ["/", "(", ")", "[", "]", ",", "."],
        "fields": [
            # 검색 대상(한국어)
            {"name": "case_name", "type": "string", "locale": "ko"},
            {"name": "holding", "type": "string", "locale": "ko", "optional": True},
            {"name": "summary", "type": "string", "locale": "ko", "optional": True},
            {"name": "body", "type": "string", "locale": "ko", "optional": True},
            {"name": "refs_article", "type": "string", "locale": "ko", "optional": True},
            # 필터/패싯
            {"name": "court", "type": "string", "facet": True, "optional": True},
            {"name": "case_type", "type": "string", "facet": True, "optional": True},
            {"name": "judgment_type", "type": "string", "facet": True, "optional": True},
            {"name": "decided_year", "type": "string", "facet": True, "optional": True},
            # 정렬/범위
            {"name": "decided_date", "type": "int64"},
            # 메타(검색X, 표시/링크용)
            {"name": "case_no", "type": "string", "optional": True},
            {"name": "serial", "type": "string", "index": False, "optional": True},
            {"name": "source_url", "type": "string", "index": False, "optional": True},
            {"name": "file_path", "type": "string", "index": False, "optional": True},
        ],
    }
```

- [ ] **Step 3: import 스모크**

Run: `cd search/indexer && python -c "from schema_prec import collection_schema; print(collection_schema('kr_precedents')['name'])"`
Expected: `kr_precedents`

- [ ] **Step 4: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/indexer/config_prec.py search/indexer/schema_prec.py
git commit -m "feat(prec): 판례 인덱서 config + Typesense 스키마"
```

---

### Task 8: parse_prec.py — 마크다운 → 도큐먼트 (TDD)

**Files:**
- Test: `search/indexer/tests/test_parse_prec.py`
- Create: `search/indexer/tests/__init__.py` (없으면)
- Create: `search/indexer/parse_prec.py`

- [ ] **Step 1: 실패 테스트 작성**

`search/indexer/tests/test_parse_prec.py`:
```python
from pathlib import Path

from parse_prec import parse_file

SAMPLE = """---
제목: 강제추행
판례일련번호: "228541"
사건번호: 2021도3451
법원명: 대법원
사건종류명: 형사
판결유형: 판결
선고일자: 2022-08-19
참조조문:
  - 형사소송법 제307조
  - 형법 제298조
상태: 시행
출처: https://www.law.go.kr/판례/(228541)
---

# 강제추행

## 판시사항
성폭력 사건에서 ...

## 판결요지
피해자 진술의 신빙성 ...

## 참조조문
형사소송법 제307조

## 판례내용
【피 고 인】 ...
"""


def test_parse_file(tmp_path: Path):
    root = tmp_path
    p = root / "2022" / "2021도3451(228541).md"
    p.parent.mkdir(parents=True)
    p.write_text(SAMPLE, encoding="utf-8")

    doc = parse_file(p, root)
    assert doc["serial"] == "228541"
    assert doc["case_name"] == "강제추행"
    assert doc["case_no"] == "2021도3451"
    assert doc["court"] == "대법원"
    assert doc["case_type"] == "형사"
    assert doc["judgment_type"] == "판결"
    assert doc["decided_date"] == 20220819
    assert doc["decided_year"] == "2022"
    assert "성폭력" in doc["holding"]
    assert "신빙성" in doc["summary"]
    assert "형사소송법 제307조" in doc["refs_article"]
    assert "피 고 인" in doc["body"]
    assert doc["file_path"] == "2022/2021도3451(228541).md"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd search/indexer && python -m pytest tests/test_parse_prec.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'parse_prec'`

- [ ] **Step 3: parse_prec.py 구현**

`search/indexer/parse_prec.py`:
```python
"""판례 마크다운(.md) 1개를 검색 도큐먼트(dict) 1개로 파싱한다.

법령 parse.py 와 달리 조문 분할을 하지 않는다(판례 1건 = 도큐먼트 1개).
섹션(## 판시사항/## 판결요지/## 참조조문/## 참조판례/## 판례내용)을 분리한다.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        data = yaml.safe_load(m.group(1)) or {}
        if not isinstance(data, dict):
            data = {}
    except yaml.YAMLError:
        data = {}
    return data, text[m.end():]


def _to_int_date(value) -> int:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) >= 8:
        try:
            return int(digits[:8])
        except ValueError:
            return 0
    return 0


def _sections(body: str) -> dict[str, str]:
    """## 헤더 기준으로 섹션 분리 → {제목: 본문}."""
    out: dict[str, str] = {}
    matches = list(_SECTION_RE.finditer(body))
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out[title] = body[start:end].strip()
    return out


def _join_refs(value) -> str:
    if isinstance(value, list):
        return " / ".join(str(v).strip() for v in value if str(v).strip())
    return str(value or "").strip()


def parse_file(path: Path, prec_root: Path) -> dict:
    """파일 1개 → 검색 도큐먼트 dict. 읽기 실패는 예외로 전파."""
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    sec = _sections(body)

    decided = _to_int_date(meta.get("선고일자"))
    rel = path.relative_to(prec_root)

    return {
        "serial": str(meta.get("판례일련번호") or "").strip(),
        "case_name": str(meta.get("제목") or "").strip(),
        "case_no": str(meta.get("사건번호") or "").strip(),
        "court": str(meta.get("법원명") or "").strip(),
        "case_type": str(meta.get("사건종류명") or "").strip(),
        "judgment_type": str(meta.get("판결유형") or "").strip(),
        "decided_date": decided,
        "decided_year": str(decided)[:4] if decided else "",
        "holding": sec.get("판시사항", ""),
        "summary": sec.get("판결요지", ""),
        "refs_article": _join_refs(meta.get("참조조문")) or sec.get("참조조문", ""),
        "body": sec.get("판례내용", ""),
        "source_url": str(meta.get("출처") or "").strip(),
        "file_path": str(rel),
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd search/indexer && python -m pytest tests/test_parse_prec.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/indexer/parse_prec.py search/indexer/tests/test_parse_prec.py search/indexer/tests/__init__.py
git commit -m "feat(prec): 판례 마크다운→도큐먼트 파서 parse_prec + 테스트"
```

> 참고: `search/indexer/tests/__init__.py` 가 이미 없으면 빈 파일로 생성. pytest 가 `indexer/` 를 루트로 실행하므로 `from parse_prec import ...` 가 동작한다(기존 indexer 모듈과 동일한 평면 import 규칙).

---

### Task 9: index_prec.py — 색인 CLI

**Files:**
- Create: `search/indexer/index_prec.py`

- [ ] **Step 1: index_prec.py 구현** (기존 `indexer/index.py` 미러, 도큐먼트=판례 1건)

`search/indexer/index_prec.py`:
```python
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
```

- [ ] **Step 2: Typesense 기동 + 색인 스모크**

Run:
```bash
cd search && make up           # Typesense (localhost:8108)
cd indexer && python index_prec.py
```
Expected: `[done] 파일 N → 인덱싱 성공 N` (Task 5에서 수집된 소수 판례).

- [ ] **Step 3: 검색 확인**

Run:
```bash
curl -s "http://localhost:8108/collections/kr_precedents/documents/search?q=강제추행&query_by=case_name,holding,summary,body" \
  -H "X-TYPESENSE-API-KEY: legalize_dev_key" | python3 -c "import sys,json;print(json.load(sys.stdin).get('found'))"
```
Expected: `found` ≥ 0 (수집된 데이터에 매칭되면 ≥1).

- [ ] **Step 4: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/indexer/index_prec.py
git commit -m "feat(prec): 판례 Typesense 색인 CLI index_prec (--keep/--alias)"
```

---

## Phase 3 — UI (법령/판례 탭)

> 이 repo의 UI에는 테스트 프레임워크가 없으므로 검증은 타입체크(`pnpm build`)와 브라우저 스모크로 한다.

### Task 10: typesense.ts — 판례 어댑터 + 타입

**Files:**
- Modify: `search/ui/src/lib/typesense.ts`

- [ ] **Step 1: 판례 컬렉션/어댑터/타입 추가**

`search/ui/src/lib/typesense.ts` 끝부분(`export const searchClient = adapter.searchClient;` 아래)에 추가:
```typescript
// ── 판례(precedents) ─────────────────────────────────────────────
export const PREC_COLLECTION =
  (env.VITE_TYPESENSE_PREC_COLLECTION as string) || "kr_precedents";

const precAdapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: (env.VITE_TYPESENSE_SEARCH_KEY as string) || DEFAULTS.searchKey,
    nodes: [
      {
        host: (env.VITE_TYPESENSE_HOST as string) || DEFAULTS.host,
        port: Number(env.VITE_TYPESENSE_PORT) || DEFAULTS.port,
        protocol: (env.VITE_TYPESENSE_PROTOCOL as string) || DEFAULTS.protocol,
      },
    ],
    cacheSearchResultsForSeconds: 120,
  },
  additionalSearchParameters: {
    query_by: "case_name,holding,summary,body,refs_article",
    query_by_weights: "5,4,4,2,1",
    highlight_full_fields: "case_name,holding,summary",
    highlight_affix_num_tokens: 16,
    num_typos: "1",
    sort_by: "_text_match:desc,decided_date:desc",
  },
});

export const precSearchClient = precAdapter.searchClient;

/** 판례 검색 도큐먼트 타입 */
export interface PrecHit {
  id: string;
  serial?: string;
  case_name: string;
  case_no?: string;
  court?: string;
  case_type?: string;
  judgment_type?: string;
  decided_date: number;
  decided_year?: string;
  holding?: string;
  summary?: string;
  body?: string;
  refs_article?: string;
  source_url?: string;
  file_path?: string;
}
```

- [ ] **Step 2: 타입체크**

Run: `cd search/ui && pnpm install && pnpm exec tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/ui/src/lib/typesense.ts
git commit -m "feat(prec/ui): 판례 Typesense 어댑터 + PrecHit 타입"
```

---

### Task 11: PrecedentHitCard + ModeTabs 컴포넌트

**Files:**
- Create: `search/ui/src/components/PrecedentHitCard.tsx`
- Create: `search/ui/src/components/ModeTabs.tsx`

- [ ] **Step 1: PrecedentHitCard 작성** (기존 `LawHitCard.tsx` 의 마크업/Highlight 패턴을 따름)

먼저 참고: `cat search/ui/src/components/LawHitCard.tsx` 로 카드 구조/Highlight import 경로를 확인한 뒤, 동일 패턴으로 작성한다.

`search/ui/src/components/PrecedentHitCard.tsx`:
```tsx
import { Highlight } from "react-instantsearch";
import type { Hit } from "instantsearch.js";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PrecHit } from "@/lib/typesense";

function fmtDate(n?: number): string {
  if (!n) return "";
  const s = String(n);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}

export function PrecedentHitCard({ hit }: { hit: Hit<PrecHit> }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {hit.court && <Badge variant="secondary">{hit.court}</Badge>}
        {hit.case_type && <Badge variant="outline">{hit.case_type}</Badge>}
        {hit.judgment_type && <span>{hit.judgment_type}</span>}
        {hit.decided_date ? <span>· {fmtDate(hit.decided_date)} 선고</span> : null}
        {hit.case_no && <span>· {hit.case_no}</span>}
      </div>
      <h3 className="text-base font-semibold leading-snug">
        <Highlight attribute="case_name" hit={hit} />
      </h3>
      {hit.holding ? (
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          <Highlight attribute="holding" hit={hit} />
        </p>
      ) : hit.summary ? (
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          <Highlight attribute="summary" hit={hit} />
        </p>
      ) : null}
      {hit.source_url && (
        <a
          href={hit.source_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-primary hover:underline"
        >
          원문 보기 →
        </a>
      )}
    </Card>
  );
}
```

> 주의: `LawHitCard.tsx` 가 `Card`/`Badge` 를 다른 경로/이름으로 import 하면 그 경로에 맞춘다. `line-clamp-*` 가 없으면 `@tailwindcss/line-clamp` 대신 기존 카드가 쓰는 truncation 방식을 따른다.

- [ ] **Step 2: ModeTabs 작성** (법령/판례 토글)

`search/ui/src/components/ModeTabs.tsx`:
```tsx
import { cn } from "@/lib/utils";

export type Mode = "laws" | "prec";

export function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { key: Mode; label: string }[] = [
    { key: "laws", label: "법령" },
    { key: "prec", label: "판례" },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-muted p-0.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            mode === t.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `cd search/ui && pnpm exec tsc --noEmit`
Expected: 에러 없음 (미사용 import 경고만 없으면 OK).

- [ ] **Step 4: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/ui/src/components/PrecedentHitCard.tsx search/ui/src/components/ModeTabs.tsx
git commit -m "feat(prec/ui): 판례 결과 카드 + 법령/판례 탭 컴포넌트"
```

---

### Task 12: App.tsx — mode 전환 통합

**Files:**
- Modify: `search/ui/src/App.tsx`
- Modify: `search/ui/src/components/HitsList.tsx` (히트 카드 분기)

- [ ] **Step 1: 현재 HitsList 확인 후 mode 분기 추가**

Run: `cat search/ui/src/components/HitsList.tsx`
그 구조에 맞춰, `mode` prop을 받아 `mode === "prec" ? PrecedentHitCard : LawHitCard` 로 렌더하도록 수정한다. (HitsList 가 `useHits()` 를 쓰는 경우 hit 타입만 분기.)

예(현재가 `useHits` 기반일 때):
```tsx
import { useHits } from "react-instantsearch";
import { LawHitCard } from "@/components/LawHitCard";
import { PrecedentHitCard } from "@/components/PrecedentHitCard";
import type { Mode } from "@/components/ModeTabs";

export function HitsList({ mode }: { mode: Mode }) {
  const { items } = useHits();
  return (
    <div className="flex flex-col gap-3">
      {items.map((hit) =>
        mode === "prec" ? (
          <PrecedentHitCard key={hit.objectID} hit={hit as any} />
        ) : (
          <LawHitCard key={hit.objectID} hit={hit as any} />
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx — mode 상태 + InstantSearch 컬렉션/어댑터 전환**

`search/ui/src/App.tsx` 의 `App()` 컴포넌트를 수정한다. URL 동기화를 위해 mode를 URL 쿼리에서 초기화하고, 변경 시 반영한다. InstantSearch는 `key={mode}` 로 재마운트하여 컬렉션과 어댑터를 함께 바꾼다.

상단 import 추가:
```tsx
import { searchClient, precSearchClient, COLLECTION, PREC_COLLECTION } from "@/lib/typesense";
import { ModeTabs, type Mode } from "@/components/ModeTabs";
```

`App()` 본문 교체:
```tsx
export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);

  // URL ?tab=prec 로 모드 초기화 + 동기화
  const initial = (typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tab") === "prec")
    ? "prec" : "laws";
  const [mode, setMode] = useState<Mode>(initial as Mode);

  const onModeChange = (m: Mode) => {
    setMode(m);
    const url = new URL(window.location.href);
    if (m === "prec") url.searchParams.set("tab", "prec");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteMounted(true);
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const client = mode === "prec" ? precSearchClient : searchClient;
  const indexName = mode === "prec" ? PREC_COLLECTION : COLLECTION;

  return (
    <InstantSearch
      key={mode}
      searchClient={client}
      indexName={indexName}
      future={{ preserveSharedStateOnUnmount: true }}
      routing
    >
      <Configure hitsPerPage={12} />
      {paletteMounted && (
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </Suspense>
      )}
      <Shell mode={mode} onModeChange={onModeChange} />
    </InstantSearch>
  );
}
```

- [ ] **Step 3: Shell 에 ModeTabs + mode 전달**

`Shell` 시그니처를 `function Shell({ mode, onModeChange }: { mode: Mode; onModeChange: (m: Mode) => void })` 로 바꾸고:
- 헤더/검색바 근처에 `<ModeTabs mode={mode} onChange={onModeChange} />` 배치.
- 결과 영역의 `<HitsList />` 를 `<HitsList mode={mode} />` 로 변경.
- 좌측 패싯(`RefinementFacet`)을 mode 분기: 법령이면 기존(law_type/ministry/status), 판례면 `court`/`case_type`/`decided_year`/`judgment_type` 속성으로 렌더.

판례 패싯 예:
```tsx
{mode === "prec" ? (
  <>
    <RefinementFacet attribute="court" title="법원" />
    <RefinementFacet attribute="case_type" title="사건종류" />
    <RefinementFacet attribute="decided_year" title="선고연도" />
    <RefinementFacet attribute="judgment_type" title="판결유형" />
  </>
) : (
  <>
    {/* 기존 법령 패싯 그대로 */}
  </>
)}
```

> `RefinementFacet` 의 실제 prop 이름(`attribute`/`title` 등)은 `cat search/ui/src/components/RefinementFacet.tsx` 로 확인 후 맞춘다.

- [ ] **Step 4: 타입체크 + 빌드**

Run: `cd search/ui && pnpm exec tsc --noEmit && pnpm build`
Expected: 타입 에러 0, 빌드 성공.

- [ ] **Step 5: 브라우저 스모크**

Run: `cd search && make ui` (→ http://localhost:8088)
확인: 상단 법령/판례 탭 전환 시 결과·패싯이 바뀐다. 판례 탭에서 "강제추행" 검색 시 판례 카드 표시(데이터가 색인된 경우). URL에 `?tab=prec` 반영.

- [ ] **Step 6: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/ui/src/App.tsx search/ui/src/components/HitsList.tsx
git commit -m "feat(prec/ui): 법령/판례 모드 전환 통합 (탭·컬렉션·패싯)"
```

---

## Phase 4 — 자동화 + 문서

### Task 13: Makefile 타깃 + .env.example

**Files:**
- Modify: `search/Makefile`
- Modify: `search/.env.example`

- [ ] **Step 1: Makefile 타깃 추가**

먼저 `cat search/Makefile` 로 기존 타깃 스타일 확인. 다음 타깃 추가(기존 변수/패턴 따름):
```make
collect-prec:        ## 대법원 판례 전량 수집(신규만)
	cd collector_prec && python -m collector_prec.fetch

commit-prec:         ## 수집된 판례를 선고일자 커밋으로 기록
	python -m collector_prec.commit

index-prec:          ## 판례 Typesense 색인(무중단 alias)
	cd indexer && python index_prec.py --alias
```
> 실제 들여쓰기는 탭(TAB)이어야 한다. `cd` 경로는 기존 `index`/`ui` 타깃과 동일한 기준으로 맞춘다.

- [ ] **Step 2: .env.example 에 신규 변수 문서화**

`search/.env.example` 에 추가:
```
# 판례 수집/색인
PREC_ROOT=../prec
PREC_COLLECTION=kr_precedents
```

- [ ] **Step 3: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add search/Makefile search/.env.example
git commit -m "chore(prec): Makefile 타깃(collect/commit/index-prec) + .env.example"
```

---

### Task 14: GitHub Actions 증분 수집 워크플로

**Files:**
- Create: `.github/workflows/collect-precedents.yml`

- [ ] **Step 1: 기존 워크플로 확인**

Run: `ls -la .github/workflows 2>/dev/null && cat .github/workflows/*.yml 2>/dev/null | head -80`
(기존 법령/행정규칙 수집 워크플로가 있으면 그 구조·시크릿 이름·푸시 방식을 그대로 따른다. 없으면 아래 신규 작성.)

- [ ] **Step 2: 워크플로 작성**

`.github/workflows/collect-precedents.yml`:
```yaml
name: 판례 증분 수집

on:
  schedule:
    - cron: "30 19 * * *"   # 매일 04:30 KST (UTC 19:30)
  workflow_dispatch: {}

permissions:
  contents: write

concurrency:
  group: collect-precedents
  cancel-in-progress: false

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: 의존성 설치
        working-directory: search
        run: pip install -r collector_prec/requirements.txt

      - name: 판례 수집(신규만)
        working-directory: search
        env:
          LAW_GO_KR_OC: ${{ secrets.LAW_GO_KR_OC }}
        run: python -m collector_prec.fetch

      - name: 선고일자 커밋
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          cd search && python -m collector_prec.commit

      - name: 푸시
        run: git push
```

> 시크릿 `LAW_GO_KR_OC` 는 리포지토리 Settings → Secrets 에 등록되어 있어야 한다. 기존 수집 워크플로가 다른 시크릿 이름을 쓰면 그것을 재사용한다. 인덱싱은 별도 배포 파이프라인(`index_prec.py --alias`)에서 수행 — 기존 법령 인덱싱 운영 방식과 동일하게 연결한다.

- [ ] **Step 3: 워크플로 문법 점검**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/collect-precedents.yml')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 4: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add .github/workflows/collect-precedents.yml
git commit -m "ci(prec): 판례 일일 증분 수집 워크플로"
```

---

### Task 15: 문서 갱신 (README)

**Files:**
- Modify: `README.md`
- Modify: `search/README.md`

- [ ] **Step 1: 루트 README 에 prec/ 구조 추가**

`README.md` 의 "구조" 섹션 뒤에 판례 단락 추가:
```markdown
## 판례 (prec/)

대법원 판례를 별도 `prec/` 디렉터리에 저장합니다. 판례는 개정되지 않는
불변 문서이므로 **1 판례 = 1 커밋(선고일자)** 모델을 따릅니다.

```
prec/
  {선고연도}/
    {사건번호}({판례일련번호}).md
```

예: `prec/2022/2021도3451(228541).md`

각 파일은 YAML frontmatter(제목·판례일련번호·사건번호·법원명·사건종류명·
판결유형·선고일자·참조조문·참조판례·출처)와 본문 섹션(판시사항·판결요지·
참조조문·참조판례·판례내용)으로 구성됩니다.
```

- [ ] **Step 2: search/README 에 수집·색인 절차 추가**

`search/README.md` 에 판례 수집/색인 단락 추가:
```markdown
## 판례 수집·색인

```bash
cd search
make collect-prec   # 대법원 판례 전량 수집(신규만) → prec/
make commit-prec    # 선고일자 커밋으로 기록
make index-prec     # Typesense kr_precedents 컬렉션 색인(무중단)
```

UI 상단의 **법령 / 판례 탭**으로 두 컬렉션을 전환 검색합니다
(`?tab=prec` 로 링크 공유 가능).
```

- [ ] **Step 3: Commit**

```bash
cd /Users/zihado/work/playground/law.zihado.com
git add README.md search/README.md
git commit -m "docs(prec): 판례 저장 구조 + 수집/색인 절차 문서화"
```

---

## Phase 5 — 초기 적재(back-fill) + 전량 색인

> 대규모 작업. 네트워크·시간 소요가 크므로 마지막에 한 번 수행한다.

### Task 16: 전량 수집 + 커밋 + 색인

- [ ] **Step 1: 전량 수집**

Run: `cd search && python -m collector_prec.fetch`
Expected: `[done] 처리 ~75000 → 저장 N, 본문미제공 M, 실패 0` (국세 등 본문미제공은 정상). 시간 소요 큼(throttle 0.15s).

- [ ] **Step 2: 전량 커밋**

Run: `cd search && python -m collector_prec.commit`
Expected: 신규 판례 수만큼 커밋 생성(각 선고일자). 진행 로그 200건 단위 출력.

- [ ] **Step 3: 전량 색인**

Run: `cd search/indexer && python index_prec.py --alias`
Expected: `[done] 파일 N → 인덱싱 성공 N`, alias `kr_precedents` 전환.

- [ ] **Step 4: 최종 검증**

Run:
```bash
curl -s "http://localhost:8108/collections/kr_precedents/documents/search?q=손해배상&query_by=case_name,holding,summary&per_page=1" \
  -H "X-TYPESENSE-API-KEY: legalize_dev_key" | python3 -c "import sys,json;d=json.load(sys.stdin);print('found:',d.get('found'))"
```
Expected: `found:` 수천 이상. UI 판례 탭에서 검색·패싯·하이라이트 정상 동작.

- [ ] **Step 5: 데이터 푸시는 사용자 확인 후**

> prec/ 의 대량 커밋(수만 건)을 원격에 푸시하는 것은 비가역적이므로, 푸시 전 사용자에게 확인을 받는다.

---

## Self-Review (작성자 점검 결과)

**1. 스펙 커버리지:**
- 스펙 §3 디렉터리/§4 포맷 → Task 2(convert)·Task 3(write) ✅
- 스펙 §5 커밋 모델(불변·선고일자·epoch 클램프) → Task 6(commit.py) ✅
- 스펙 §6 수집기 → Task 1·4·5 ✅ (resume는 set 기반 `existing_serials`)
- 스펙 §7 인덱서(별도 컬렉션·가중치·패싯) → Task 7·8·9 ✅ (가중치 case_name5/holding4/summary4/body2/refs1)
- 스펙 §8 UI(탭·카드·패싯·URL) → Task 10·11·12 ✅
- 스펙 §9 자동화(back-fill·cron) → Task 14·16 ✅
- 스펙 §11 테스트 전략 → convert/write/parse_prec 단위테스트 + 색인 스모크 ✅

**2. Placeholder 스캔:** 코드 스텝은 모두 실제 코드 포함. UI Task 11/12는 기존 컴포넌트의 정확한 prop/이름을 `cat` 으로 확인 후 맞추라는 지시 포함(이 repo에 UI 테스트가 없어 불가피한 적응 지점) — 추측 금지·확인 절차 명시로 처리.

**3. 타입/이름 일관성:**
- `Converted(serial, case_no, decided_date, case_name, markdown)` ↔ fetch.py `conv.case_no/conv.decided_date/conv.serial` 일치 ✅
- `resolve_path(root, case_no, decided_date, serial)` 시그니처 ↔ fetch.py 호출 일치 ✅
- 도큐먼트 필드(serial/case_name/case_no/court/case_type/judgment_type/decided_date/decided_year/holding/summary/body/refs_article/source_url/file_path) ↔ schema_prec 필드 ↔ parse_prec 반환 ↔ PrecHit 타입 일치 ✅
- 컬렉션명 `kr_precedents` ↔ config_prec/PREC_COLLECTION/UI 기본값 일치 ✅
- query_by 필드(case_name,holding,summary,body,refs_article) ↔ schema 검색필드 일치 ✅

발견된 불일치 없음.
