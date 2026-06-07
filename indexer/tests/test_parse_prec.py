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
