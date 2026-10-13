from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.main import app
from app.models import Admin, CreditLimitChange, MenuItem, Staff, Student, WalletTransaction, utc_now

PASSWORD = "accounts-test-password"
TOPUP = {"request_key": "topup-request-0001", "amount": 50000, "reference": "Receipt NCE-001"}


@pytest.fixture
def accounts(migrated_db, monkeypatch):
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
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024)))
        db.add(MenuItem(name="Veg momo", category="Momo", price=12000))
        db.commit()
    with TestClient(app) as client:
        login(client)
        yield client, engine


def login(client, role="admin", username="accounts"):
    result = client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]


def test_fund_order_and_view_own_history(accounts):
    client, engine = accounts
    first = client.post("/admin/accounts/1/top-ups", json=TOPUP)
    assert first.status_code == 201
    again = client.post("/admin/accounts/1/top-ups", json=TOPUP)
    assert again.status_code == 200 and again.json() == first.json()
    limit = client.patch("/admin/accounts/1/credit-limit", json={"credit_limit": 20000, "expected_credit_limit": 0, "reason": "Approved by accounts"})
    assert limit.json()["remaining_credit"] == 20000
    audit = client.get("/admin/accounts/1/credit-limit-history").json()
    assert [(x["old_limit"], x["new_limit"], x["admin_id"]) for x in audit] == [(0, 20000, 1)]
    login(client, "student", "NCE-001")
    for i in range(5):
        placed = client.post("/orders", json={"checkout_key": f"account-order-{i:04d}", "expected_total": 12000,
                                              "items": [{"menu_item_id": 1, "quantity": 1}]})
        assert placed.status_code == 201, placed.text
    balance = client.get("/wallet").json()
    assert (balance["wallet_balance"], balance["credit_balance"], balance["remaining_credit"]) == (2000, 12000, 8000)
    history = client.get("/wallet/transactions").json()
    assert sum(x["amount"] for x in history) == 2000
    assert history[-1]["reference"] == "Receipt NCE-001"
    assert client.get("/wallet/credit?status=outstanding").json()[0]["amount"] == 12000
    assert client.get("/wallet/credit?status=settled").json() == []
    login(client, "student", "NCE-002")
    assert client.get("/wallet/transactions").json() == []
    assert client.get("/wallet/credit").json() == []


def test_key_reuse_for_other_amount_or_student_rejected(accounts):
    client, engine = accounts
    assert client.post("/admin/accounts/1/top-ups", json=TOPUP).status_code == 201
    assert client.post("/admin/accounts/1/top-ups", json=TOPUP | {"amount": 60000}).status_code == 409
    assert client.post("/admin/accounts/2/top-ups", json=TOPUP).status_code == 409
    with Session(engine) as db:
        assert db.get(Student, 1).wallet_balance == 50000
        assert db.get(Student, 2).wallet_balance == 0


def test_concurrent_topup_retries_credit_once(accounts):
    client, engine = accounts
    barrier = Barrier(5)
    def submit(_):
        barrier.wait(timeout=10)
        return client.post("/admin/accounts/1/top-ups", json=TOPUP)
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(submit, range(5)))
    assert sorted(r.status_code for r in responses) == [200, 200, 200, 200, 201]
    assert len({r.json()["id"] for r in responses}) == 1
    with Session(engine) as db:
        assert db.get(Student, 1).wallet_balance == 50000
        assert db.scalar(select(func.count()).select_from(WalletTransaction)) == 1


def test_credit_limit_boundary_and_stale_edits(accounts):
    client, engine = accounts
    with Session(engine) as db:
        student = db.get(Student, 1)
        student.credit_limit, student.credit_balance = 20000, 12000
        db.commit()
    url = "/admin/accounts/1/credit-limit"
    assert client.patch(url, json={"credit_limit": 11999, "expected_credit_limit": 20000, "reason": "Reduce limit"}).status_code == 409
    assert client.patch(url, json={"credit_limit": 12000, "expected_credit_limit": 20000, "reason": "Reduce limit"}).status_code == 200
    assert client.patch(url, json={"credit_limit": 18000, "expected_credit_limit": 20000, "reason": "Stale screen"}).status_code == 409
    with Session(engine) as db:
        assert db.get(Student, 1).credit_limit == 12000
        assert db.scalar(select(func.count()).select_from(CreditLimitChange)) == 1


@pytest.mark.parametrize("role,username", [("student", "NCE-001"), ("staff", "counter")])
def test_accounts_require_admin(accounts, role, username):
    client, _ = accounts
    login(client, role, username)
    assert client.post("/admin/accounts/1/top-ups", json=TOPUP).status_code == 403
    assert client.get("/admin/accounts/1").status_code == 403
    assert client.patch("/admin/accounts/1/credit-limit", json={"credit_limit": 10000, "expected_credit_limit": 0, "reason": "Attempt"}).status_code == 403


@pytest.mark.parametrize("amount", [-1, 0, 1.5, True, "50000"])
def test_topups_require_positive_integer_paisa(accounts, amount):
    client, _ = accounts
    assert client.post("/admin/accounts/1/top-ups", json=TOPUP | {"amount": amount}).status_code == 422


def test_topup_requires_csrf_and_active_account(accounts):
    client, engine = accounts
    with Session(engine) as db:
        db.get(Student, 1).is_active = False
        db.commit()
    assert client.post("/admin/accounts/1/top-ups", json=TOPUP).status_code == 409
    del client.headers["X-CSRF-Token"]
    assert client.post("/admin/accounts/2/top-ups", json=TOPUP).status_code == 403


def test_migration_preserves_existing_wallet_entries(migrated_db):
    engine, config = migrated_db
    command.downgrade(config, "0002")
    with engine.begin() as conn:
        conn.exec_driver_sql("INSERT INTO admins (id, name, username, password_hash) VALUES (1, 'Accounts', 'accounts', 'fixture')")
        conn.exec_driver_sql("""INSERT INTO students (id, roll_no, name, department, semester, email, password_hash, created_at)
                               VALUES (1, 'NCE-001', 'Student', 'Computer', 1, 's@example.com', 'fixture', CURRENT_TIMESTAMP)""")
        conn.exec_driver_sql("""INSERT INTO wallet_transactions (student_id, amount, type, admin_id, reference, timestamp)
                               VALUES (1, 50000, 'top_up', 1, 'Old receipt', CURRENT_TIMESTAMP)""")
    command.upgrade(config, "head")
    with Session(engine) as db:
        transaction = db.scalar(select(WalletTransaction))
        assert (transaction.amount, transaction.reference, transaction.request_key) == (50000, "Old receipt", None)


def test_failed_receipt_write_rolls_back_topup(accounts):
    from sqlalchemy.exc import IntegrityError
    client, engine = accounts
    with engine.begin() as conn:
        conn.exec_driver_sql("""CREATE TRIGGER fail_topup BEFORE INSERT ON wallet_transactions
                               BEGIN SELECT RAISE(ABORT, 'test receipt failure'); END""")
    with pytest.raises(IntegrityError):
        client.post("/admin/accounts/1/top-ups", json=TOPUP)
    with Session(engine) as db:
        assert db.get(Student, 1).wallet_balance == 0
        assert db.scalar(select(func.count()).select_from(WalletTransaction)) == 0
