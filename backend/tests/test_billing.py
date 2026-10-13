import csv
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from io import StringIO
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import ordering
from app.auth import hash_password
from app.main import app
from app.models import Admin, BillingSettlement, CreditLedger, MenuItem, Staff, Student, utc_now
from app.ordering import place_order
from app.schemas import CheckoutCreate

PASSWORD = "billing-test-password"
SETTLEMENT = {"request_key": "settlement-000001", "student_id": 1, "ledger_ids": [1, 2],
              "expected_amount": 24000, "reference": "Accounts transfer NCE-001"}


def order(engine, key, student_id=1):
    with Session(engine) as db:
        place_order(db, student_id, CheckoutCreate(checkout_key=key, expected_total=12000,
                                                  items=[{"menu_item_id": 1, "quantity": 1}]))
        db.commit()


@pytest.fixture
def billing_client(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    hashed = hash_password(PASSWORD)
    with Session(engine) as db:
        admin = Admin(name="Accounts", username="accounts", password_hash=hashed)
        db.add(admin)
        db.flush()
        db.add(Staff(name="Counter", username="counter", password_hash=hashed))
        for i in (1, 2):
            db.add(Student(roll_no=f"NCE-00{i}", name=f"Student {i}", department="Computer", semester=3,
                           email=f"s{i}@example.com", password_hash=hashed, approval_status="approved",
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024), credit_limit=100000))
        db.add(MenuItem(name="Veg momo", price=12000, category="Momo"))
        db.commit()
    monkeypatch.setattr(ordering, "utc_now", lambda: datetime(2026, 8, 20, 5))
    order(engine, "billing-order-0001")
    monkeypatch.setattr(ordering, "utc_now", lambda: datetime(2026, 9, 20, 5))
    order(engine, "billing-order-0002")
    order(engine, "billing-order-0003", 2)
    with TestClient(app) as client:
        login(client)
        yield client, engine


def login(client, role="admin", username="accounts"):
    response = client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


def test_csv_month_filter_and_inactive_dues(billing_client):
    client, engine = billing_client
    with Session(engine) as db:
        student = db.get(Student, 1)
        student.is_active = False
        student.name = '=HYPERLINK("x")'
        student.department = "Electronics, IT"
        db.commit()
    response = client.get("/admin/billing/outstanding.csv?month=2026-08")
    assert response.status_code == 200
    rows = list(csv.DictReader(StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 1
    assert rows[0]["name"] == '\'=HYPERLINK("x")'
    assert rows[0]["department"] == "Electronics, IT"
    assert (rows[0]["outstanding_paisa"], rows[0]["outstanding_npr"], rows[0]["ledger_ids"]) == ("12000", "120.00", "1")
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/admin/billing/outstanding?month=2026-13").status_code == 422
    empty = client.get("/admin/billing/outstanding.csv?month=2025-01")
    assert len(list(csv.reader(StringIO(empty.content.decode("utf-8-sig"))))) == 1


def test_settle_exported_entries_leaves_new_debt(billing_client):
    client, engine = billing_client
    exported = [r for r in client.get("/admin/billing/outstanding").json() if r["student_id"] == 1]
    ids = [entry for row in exported for entry in row["ledger_ids"]]
    order(engine, "billing-order-0004")
    response = client.post("/admin/billing/settlements", json=SETTLEMENT | {"ledger_ids": ids})
    assert response.status_code == 201, response.text
    replay = client.post("/admin/billing/settlements", json=SETTLEMENT | {"ledger_ids": list(reversed(ids))})
    assert replay.status_code == 200 and replay.json() == response.json()
    with Session(engine) as db:
        student = db.get(Student, 1)
        assert (student.credit_balance, student.wallet_balance) == (12000, 0)
        assert db.get(CreditLedger, 4).status == "outstanding"
        assert db.get(CreditLedger, 1).settled_by_admin_id == 1
        assert db.get(CreditLedger, 1).settlement_reference == SETTLEMENT["reference"]
    assert len(client.get("/admin/billing/settlements?student_id=1").json()) == 1
    login(client, "student", "NCE-001")
    assert len(client.get("/wallet/credit?status=settled").json()) == 2


@pytest.mark.parametrize("changes", [{"ledger_ids": [1, 3]}, {"ledger_ids": [1, 999]}, {"expected_amount": 23999}])
def test_invalid_settlement_has_no_effect(billing_client, changes):
    client, engine = billing_client
    assert client.post("/admin/billing/settlements", json=SETTLEMENT | changes).status_code == 409
    with Session(engine) as db:
        assert db.get(Student, 1).credit_balance == 24000
        assert db.get(CreditLedger, 1).status == "outstanding"
        assert db.scalar(select(func.count()).select_from(BillingSettlement)) == 0


def test_already_settled_and_changed_key_payload_rejected(billing_client):
    client, engine = billing_client
    assert client.post("/admin/billing/settlements", json=SETTLEMENT).status_code == 201
    assert client.post("/admin/billing/settlements", json=SETTLEMENT | {"request_key": "settlement-000002"}).status_code == 409
    assert client.post("/admin/billing/settlements", json=SETTLEMENT | {"reference": "Different transfer"}).status_code == 409
    with Session(engine) as db:
        assert db.get(Student, 1).credit_balance == 0


def test_concurrent_settlement_retries_debit_once(billing_client):
    client, engine = billing_client
    barrier = Barrier(4)
    def submit(_):
        barrier.wait(timeout=10)
        return client.post("/admin/billing/settlements", json=SETTLEMENT)
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(submit, range(4)))
    assert sorted(r.status_code for r in responses) == [200, 200, 200, 201]
    with Session(engine) as db:
        assert db.get(Student, 1).credit_balance == 0
        assert db.scalar(select(func.count()).select_from(BillingSettlement)) == 1


def test_receipt_failure_rolls_back_settlement(billing_client):
    client, engine = billing_client
    with engine.begin() as conn:
        conn.exec_driver_sql("""CREATE TRIGGER fail_settlement BEFORE INSERT ON billing_settlements
                               BEGIN SELECT RAISE(ABORT, 'test settlement failure'); END""")
    with pytest.raises(IntegrityError):
        client.post("/admin/billing/settlements", json=SETTLEMENT)
    with Session(engine) as db:
        assert db.get(Student, 1).credit_balance == 24000
        assert db.get(CreditLedger, 1).status == "outstanding"
        assert db.get(CreditLedger, 1).settled_at is None


def test_disagreement_between_balance_and_ledger_blocks_settlement(billing_client):
    client, engine = billing_client
    with Session(engine) as db:
        db.get(Student, 1).credit_balance = 25000
        db.commit()
    assert client.post("/admin/billing/settlements", json=SETTLEMENT).status_code == 409


@pytest.mark.parametrize("role,username", [("student", "NCE-001"), ("staff", "counter")])
def test_billing_is_admin_only(billing_client, role, username):
    client, _ = billing_client
    login(client, role, username)
    for path in ("outstanding", "outstanding.csv", "settlements"):
        assert client.get(f"/admin/billing/{path}").status_code == 403
    assert client.post("/admin/billing/settlements", json=SETTLEMENT).status_code == 403


def test_settlement_validation_and_csrf(billing_client):
    client, _ = billing_client
    assert client.post("/admin/billing/settlements", json=SETTLEMENT | {"ledger_ids": [1, 1]}).status_code == 422
    assert client.post("/admin/billing/settlements", json=SETTLEMENT | {"expected_amount": 240.0}).status_code == 422
    del client.headers["X-CSRF-Token"]
    assert client.post("/admin/billing/settlements", json=SETTLEMENT).status_code == 403
