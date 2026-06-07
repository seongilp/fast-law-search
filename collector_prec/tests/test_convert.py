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
