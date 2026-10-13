from datetime import date

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import Base
from app.main import app
from app.models import DailyTokenCounter, Order, Student


def student(**overrides):
    values = dict(roll_no="NCE-081-001", name="Sujin", department="Computer Engineering",
                  semester=3, email="sujin@example.test", password_hash="test-only")
    return Student(**(values | overrides))


def order(student_id, day, token=1, key="checkout-1"):
    return Order(student_id=student_id, order_date=day, token_number=token,
                 total_amount=12000, payment_type="wallet", checkout_key=key,
                 request_fingerprint="a" * 64)


def test_migration_roundtrip_and_model_alignment(migrated_db):
    engine, config = migrated_db
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
    command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) == {"alembic_version"}
    command.upgrade(config, "head")
    assert set(Base.metadata.tables) <= set(inspect(engine).get_table_names())


@pytest.mark.parametrize("overrides", [
    {"wallet_balance": -1}, {"wallet_balance": 0.5},
    {"credit_limit": -1}, {"credit_balance": -1},
    {"credit_limit": 10000, "credit_balance": 10001},
    {"semester": 0}, {"approval_status": "approved"},
    {"face_encoding": b"bad"},
])
def test_invalid_student_values_rejected(migrated_db, overrides):
    engine, _ = migrated_db
    with Session(engine) as session:
        session.add(student(**overrides))
        with pytest.raises(IntegrityError):
            session.commit()


def test_credit_boundary_and_pending_default(migrated_db):
    engine, _ = migrated_db
    with Session(engine) as session:
        row = student(credit_limit=50000, credit_balance=50000)
        session.add(row)
        session.commit()
        assert row.approval_status == "pending"
        assert row.credit_balance == row.credit_limit


def test_daily_token_and_checkout_uniqueness(migrated_db):
    engine, _ = migrated_db
    with Session(engine) as session:
        row = student()
        session.add(row)
        session.flush()
        student_id = row.id
        session.add(order(student_id, date(2026, 9, 27)))
        session.commit()
        session.add(order(student_id, date(2026, 9, 27), key="checkout-2"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(order(student_id, date(2026, 9, 28), key="checkout-2"))
        session.commit()
        session.add(order(student_id, date(2026, 9, 28), token=2, key="checkout-2"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_foreign_keys_reject_unknown_student(migrated_db):
    engine, _ = migrated_db
    with Session(engine) as session:
        session.add(order(999, date(2026, 9, 27)))
        with pytest.raises(IntegrityError):
            session.commit()


def test_failed_transaction_rolls_back_token_counter(migrated_db):
    engine, _ = migrated_db
    with Session(engine) as session:
        session.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        session.add(DailyTokenCounter(order_date=date(2026, 9, 27), last_token=1))
        session.flush()
        session.add(order(999, date(2026, 9, 27)))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.scalar(select(DailyTokenCounter)) is None


def test_settlement_requires_actor_and_reference(migrated_db):
    engine, _ = migrated_db
    with Session(engine) as session:
        row = student()
        session.add(row)
        session.flush()
        placed = order(row.id, date(2026, 9, 27))
        placed.payment_type = "credit"
        session.add(placed)
        session.flush()
        session.execute(text("""
            INSERT INTO credit_ledger (student_id, order_id, amount, status, month, created_at)
            VALUES (:student_id, :order_id, 12000, 'outstanding', '2026-09', CURRENT_TIMESTAMP)
        """), {"student_id": row.id, "order_id": placed.id})
        session.commit()
        with pytest.raises(IntegrityError):
            session.execute(text("UPDATE credit_ledger SET status='settled'"))


def test_health(migrated_db):
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok", "app": "CampusDine"}
