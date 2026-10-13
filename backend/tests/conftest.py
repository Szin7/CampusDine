from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from app.db import make_engine


@pytest.fixture
def migrated_db(tmp_path, monkeypatch):
    path = tmp_path / "test.sqlite3"
    monkeypatch.setenv("CAMPUSDINE_DB_PATH", str(path))
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    engine = make_engine(path)
    yield engine, config
    engine.dispose()
