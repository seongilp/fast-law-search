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
