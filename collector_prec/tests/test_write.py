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
