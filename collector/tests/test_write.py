from pathlib import Path

from collector.write import MAX_DIR_BYTES, _dir_name, existing_mst, resolve_path, write_markdown


def test_resolve_basic(tmp_path):
    p = resolve_path(tmp_path, "전자금융감독규정", "고시", "21828")
    assert p == tmp_path / "전자금융감독규정" / "고시.md"


def test_resolve_normalizes_middot(tmp_path):
    # 목록 API 의 원본 이름(·, U+00B7)과 본문 정규화 이름(ㆍ, U+318D)이
    # 같은 경로로 해석돼야 resume(동일 MST 스킵)가 동작한다.
    raw = resolve_path(tmp_path, "10·29참사위원회운영규정", "훈령", "1")
    normalized = resolve_path(tmp_path, "10ㆍ29참사위원회운영규정", "훈령", "1")
    assert raw == normalized
    assert raw == tmp_path / "10ㆍ29참사위원회운영규정" / "훈령.md"


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


def test_dir_name_caps_byte_length(tmp_path):
    # 리눅스 ext4 는 경로 컴포넌트당 255바이트 제한이 있고 한글은 UTF-8 3바이트.
    # 긴 행정규칙명/판례명이 그대로 디렉터리명이 되면 checkout 이 깨진다.
    long_name = "가" * 400  # 1200 bytes
    d = _dir_name(long_name)
    assert len(d.encode("utf-8")) <= MAX_DIR_BYTES
    # 멀티바이트 문자가 중간에 잘려 깨지지 않아야 한다
    d.encode("utf-8").decode("utf-8")


def test_dir_name_truncation_is_deterministic_and_unique(tmp_path):
    # 같은 이름 → 같은 디렉터리(resume/dedup 동작 보장)
    a = "관세법" + "가" * 400
    b = "관세법" + "나" * 400
    assert _dir_name(a) == _dir_name(a)
    # 접두사가 같아도 서로 다른 긴 이름은 다른 디렉터리로 (충돌 방지)
    assert _dir_name(a) != _dir_name(b)


def test_dir_name_idempotent_on_already_normalized(tmp_path):
    # 이미 _dir_name 을 거친 값에 다시 적용해도 같은 결과(마이그레이션 일관성)
    long_name = "10·29" + "가" * 400
    once = _dir_name(long_name)
    assert _dir_name(once) == once


def test_dir_name_short_unchanged(tmp_path):
    # 짧은 이름은 기존 동작 그대로(정규화 + 공백 제거)
    assert _dir_name("10·29 참사 위원회 운영규정") == "10ㆍ29참사위원회운영규정"


def test_resolve_long_name_is_linux_safe(tmp_path):
    p = resolve_path(tmp_path, "관세" + "가" * 400, "고시", "1")
    for part in p.relative_to(tmp_path).parts:
        assert len(part.encode("utf-8")) <= 255


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
