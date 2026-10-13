from collections.abc import Iterator
from pathlib import Path

from fastapi import Request

from sqlalchemy import Engine, URL, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session


class Base(DeclarativeBase):
    pass


def make_engine(path: Path) -> Engine:
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        URL.create("sqlite", database=str(path)),
        connect_args={"check_same_thread": False, "timeout": 10},
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _record):
        # Explicit BEGIN keeps DDL and savepoints inside the transaction.
        connection.isolation_level = None
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=FULL")
        cursor.close()

    @event.listens_for(engine, "begin")
    def begin_transaction(connection):
        # Checkout will request IMMEDIATE before reading balances or tokens.
        mode = connection.get_execution_options().get("sqlite_begin_mode", "DEFERRED")
        if mode not in {"DEFERRED", "IMMEDIATE"}:
            raise ValueError("Unsupported SQLite transaction mode")
        connection.exec_driver_sql(f"BEGIN {mode}")

    return engine


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.db_engine, expire_on_commit=False) as session:
        # Serialize writes before auth reads; this avoids a stale read-to-write upgrade.
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path not in {"/students/enroll", "/counter/identify", "/auth/face-login"}:
            session.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        yield session
