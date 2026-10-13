"""Create a consistent SQLite backup without copying a live WAL database file."""
import argparse
import os
import sqlite3
from pathlib import Path

from app.config import database_path


def backup_database(source: Path, destination: Path) -> Path:
    source, destination = source.resolve(), destination.absolute()
    if not source.is_file():
        raise FileNotFoundError(f"Database does not exist: {source}")
    if source == destination.resolve():
        raise ValueError("Backup destination must differ from the live database")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents a repeated command from replacing an earlier backup.
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    try:
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original:
            with sqlite3.connect(destination) as copy:
                original.backup(copy, pages=256, sleep=0.1)
                if copy.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise ValueError("Backup failed SQLite integrity validation")
                copy.execute("PRAGMA journal_mode=DELETE")
            copy.close()
        original.close()
    except BaseException:
        # Context managers finish transactions but do not close SQLite connections.
        if "copy" in locals():
            copy.close()
        if "original" in locals():
            original.close()
        destination.unlink(missing_ok=True)
        for suffix in ("-wal", "-shm", "-journal"):
            Path(str(destination) + suffix).unlink(missing_ok=True)
        raise
    return destination


def main():
    parser = argparse.ArgumentParser(description="Back up the configured CampusDine SQLite database to a NEW file.")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = backup_database(database_path(), args.output)
    except (OSError, ValueError, sqlite3.Error) as exc:
        parser.exit(1, f"Backup failed: {exc}\n")
    print(f"Backup verified: {result}")


if __name__ == "__main__":
    main()
