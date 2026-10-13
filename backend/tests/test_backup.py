import sqlite3
from pathlib import Path

import pytest

from scripts.backup_database import backup_database


def test_backup_includes_committed_wal_and_is_independent(tmp_path):
    source, output = tmp_path / "live.sqlite3", tmp_path / "backup.sqlite3"
    connection = sqlite3.connect(source)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA wal_autocheckpoint=0")
    connection.execute("CREATE TABLE entries (amount INTEGER, face BLOB)")
    connection.execute("INSERT INTO entries VALUES (?, ?)", (12000, bytes(1024)))
    connection.commit()
    assert Path(str(source) + "-wal").stat().st_size > 0
    backup_database(source, output)
    connection.execute("INSERT INTO entries VALUES (?, ?)", (3000, bytes(1024)))
    connection.commit()
    connection.close()
    with sqlite3.connect(output) as restored:
        assert restored.execute("SELECT amount, length(face) FROM entries").fetchall() == [(12000, 1024)]
        assert restored.execute("PRAGMA quick_check").fetchone() == ("ok",)
    restored.close()
    assert not Path(str(output) + "-wal").exists()


def test_backup_refuses_overwrite_and_live_destination(tmp_path):
    source, output = tmp_path / "live.sqlite3", tmp_path / "backup.sqlite3"
    source.touch()
    output.write_bytes(b"retain this backup")
    with pytest.raises(FileExistsError):
        backup_database(source, output)
    assert output.read_bytes() == b"retain this backup"
    with pytest.raises(ValueError):
        backup_database(source, source)


def test_missing_source_is_not_created(tmp_path):
    source, output = tmp_path / "missing.sqlite3", tmp_path / "backup.sqlite3"
    with pytest.raises(FileNotFoundError):
        backup_database(source, output)
    assert not source.exists() and not output.exists()


def test_corrupt_source_removes_failed_output(tmp_path):
    source, output = tmp_path / "bad.sqlite3", tmp_path / "backup.sqlite3"
    source.write_text("This is not SQLite")
    with pytest.raises(sqlite3.DatabaseError):
        backup_database(source, output)
    assert not output.exists()
