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
