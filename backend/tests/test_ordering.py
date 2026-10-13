from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import ordering
from app.auth import hash_password
from app.main import app
from app.models import (Admin, CreditLedger, DailyTokenCounter, MenuItem, Order, OrderItem,
                        OrderStatusLog, Staff, Student, WalletTransaction, utc_now)
from app.ordering import CheckoutError, place_order
from app.schemas import CheckoutCreate

PASSWORD = "checkout-test-password"


@pytest.fixture
def shop(migrated_db):
    engine, _ = migrated_db
    password_hash = hash_password(PASSWORD)
    with Session(engine) as db:
        admin = Admin(name="Accounts", username="accounts", password_hash=password_hash)
        db.add(admin)
        db.flush()
        db.add(Staff(name="Counter", username="counter", password_hash=password_hash))
        for i in (1, 2):
            db.add(Student(roll_no=f"NCE-00{i}", name=f"Student {i}", department="Computer", semester=3,
                           email=f"s{i}@example.com", password_hash=password_hash,
                           approval_status="approved", approved_by_admin_id=admin.id, approved_at=utc_now(),
                           face_encoding=bytes(1024), wallet_balance=100000, credit_limit=50000))
        db.add(MenuItem(name="Veg momo", price=12000, category="Momo"))
        db.commit()
    return engine


def body(key="checkout-key-0001", quantity=1, total=None):
    return CheckoutCreate(checkout_key=key, items=[{"menu_item_id": 1, "quantity": quantity}],
                          expected_total=12000 * quantity if total is None else total)


def buy(engine, request=None, student_id=1, staff_id=None):
    with Session(engine, expire_on_commit=False) as db:
        order, created = place_order(db, student_id, request or body(), staff_id=staff_id)
        db.commit()
        return order.id, order.token_number, created, order.payment_type


def balances(engine, wallet, credit=0, limit=50000):
    with Session(engine) as db:
        student = db.get(Student, 1)
        student.wallet_balance, student.credit_balance, student.credit_limit = wallet, credit, limit
        db.commit()


@pytest.mark.parametrize("wallet,credit,limit,payment,end_wallet,end_credit", [
    (12000, 0, 0, "wallet", 0, 0),
    (20000, 50000, 50000, "wallet", 8000, 50000),
    (11999, 0, 12000, "credit", 11999, 12000),
    (0, 38000, 50000, "credit", 0, 50000),
])
def test_payment_boundaries(shop, wallet, credit, limit, payment, end_wallet, end_credit):
    balances(shop, wallet, credit, limit)
    result = buy(shop)
    assert result[3] == payment
    with Session(shop) as db:
        student = db.get(Student, 1)
        assert (student.wallet_balance, student.credit_balance) == (end_wallet, end_credit)
        wallet_entries = db.scalars(select(WalletTransaction)).all()
        credit_entries = db.scalars(select(CreditLedger)).all()
        if payment == "wallet":
            assert [x.amount for x in wallet_entries] == [-12000]
            assert credit_entries == []
        else:
            assert [x.amount for x in credit_entries] == [12000]
            assert wallet_entries == []
        assert db.scalar(select(OrderStatusLog)).status == "received"


def test_over_limit_rejection_has_no_side_effects(shop):
    balances(shop, 11999, 38001, 50000)
    with pytest.raises(CheckoutError, match="Insufficient"):
        buy(shop)
    with Session(shop) as db:
        assert db.scalar(select(Order)) is None
        assert db.scalar(select(DailyTokenCounter)) is None
        assert db.get(Student, 1).credit_balance == 38001


def test_nepal_midnight_resets_token_and_credit_month(shop, monkeypatch):
    balances(shop, 0, limit=100000)
    monkeypatch.setattr(ordering, "utc_now", lambda: datetime(2026, 9, 30, 18, 14, 59))
    first = buy(shop)
    second = buy(shop, body("checkout-key-0002"))
    monkeypatch.setattr(ordering, "utc_now", lambda: datetime(2026, 9, 30, 18, 15))
    third = buy(shop, body("checkout-key-0003"))
    assert [first[1], second[1], third[1]] == [1, 2, 1]
    with Session(shop) as db:
        assert [x.month for x in db.scalars(select(CreditLedger).order_by(CreditLedger.id))] == ["2026-09", "2026-09", "2026-10"]


def test_retry_survives_menu_changes_and_rejects_different_payload(shop):
    first = buy(shop)
    with Session(shop) as db:
        item = db.get(MenuItem, 1)
        item.price, item.is_available = 15000, False
        db.commit()
    again = buy(shop)
    assert again[:2] == first[:2] and again[2] is False
    with pytest.raises(CheckoutError, match="different order"):
        buy(shop, body(quantity=2))
    with Session(shop) as db:
        assert db.get(Student, 1).wallet_balance == 88000
        assert db.scalar(select(func.count()).select_from(WalletTransaction)) == 1


@pytest.mark.parametrize("change", ["price", "unavailable", "archived", "missing"])
def test_changed_menu_does_not_debit(shop, change):
    with Session(shop) as db:
        item = db.get(MenuItem, 1)
        if change == "price":
            item.price = 13000
        elif change == "unavailable":
            item.is_available = False
        elif change == "archived":
            item.is_archived = True
        else:
            db.delete(item)
        db.commit()
    with pytest.raises(CheckoutError):
        buy(shop)
    with Session(shop) as db:
        assert db.get(Student, 1).wallet_balance == 100000
        assert db.scalar(select(Order)) is None


def test_late_database_failure_rolls_back_everything(shop):
    with shop.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER fail_debit BEFORE INSERT ON wallet_transactions
                                      BEGIN SELECT RAISE(ABORT, 'test debit failure'); END""")
    with pytest.raises(IntegrityError):
        buy(shop)
    with Session(shop) as db:
        for model in (Order, OrderItem, DailyTokenCounter, WalletTransaction, CreditLedger, OrderStatusLog):
            assert db.scalar(select(func.count()).select_from(model)) == 0
        assert db.get(Student, 1).wallet_balance == 100000


def test_concurrent_orders_get_sequential_tokens(shop):
    barrier = Barrier(6)
    def submit(i):
        barrier.wait(timeout=10)
        return buy(shop, body(f"parallel-order-{i:04d}"))
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(submit, range(6)))
    assert sorted(result[1] for result in results) == list(range(1, 7))
    with Session(shop) as db:
        assert db.get(Student, 1).wallet_balance == 28000


def test_concurrent_retries_charge_once(shop):
    barrier = Barrier(6)
    def submit(_):
        barrier.wait(timeout=10)
        return buy(shop)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(submit, range(6)))
    assert len({result[0] for result in results}) == 1
    assert sum(result[2] for result in results) == 1
    with Session(shop) as db:
        assert db.get(Student, 1).wallet_balance == 88000
        assert db.scalar(select(DailyTokenCounter)).last_token == 1


def test_concurrent_orders_cannot_overspend(shop):
    balances(shop, 12000, limit=0)
    barrier = Barrier(2)
    def submit(i):
        barrier.wait(timeout=10)
        try:
            buy(shop, body(f"last-wallet-{i:05d}"))
            return "placed"
        except CheckoutError:
            return "declined"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == ["declined", "placed"]
    with Session(shop) as db:
        assert db.get(Student, 1).wallet_balance == 0
        assert db.scalar(select(DailyTokenCounter)).last_token == 1


@pytest.fixture
def client(shop, monkeypatch):
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    with TestClient(app) as client:
        sign_in(client)
        yield client


def sign_in(client, role="student", username="NCE-001"):
    result = client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]


def test_order_routes_and_student_isolation(client):
    payload = body().model_dump()
    first = client.post("/orders", json=payload)
    assert first.status_code == 201, first.text
    assert first.json()["created_at"].endswith("+00:00")
    repeated = client.post("/orders", json=payload)
    assert repeated.status_code == 200 and repeated.json() == first.json()
    assert client.get("/orders").json() == [first.json()]
    sign_in(client, username="NCE-002")
    assert client.get(f"/orders/{first.json()['id']}").status_code == 404
    assert client.get("/orders").json() == []
    assert client.post("/orders", json=payload | {"student_id": 1}).status_code == 422


def test_counter_checkout_records_staff(client, shop):
    sign_in(client, "staff", "counter")
    response = client.post("/counter/orders", json=body().model_dump() | {"student_id": 2})
    assert response.status_code == 201
    assert client.post("/orders", json=body().model_dump()).status_code == 403
    with Session(shop) as db:
        assert db.get(Order, response.json()["id"]).placed_by_staff_id == 1
        assert db.scalar(select(OrderStatusLog)).changed_by_staff_id == 1


def test_checkout_needs_csrf_and_rejects_duplicate_lines(client):
    payload = body().model_dump()
    assert client.post("/orders", json=payload | {"items": payload["items"] * 2}).status_code == 422
    del client.headers["X-CSRF-Token"]
    assert client.post("/orders", json=payload).status_code == 403


def test_inactive_student_cannot_be_charged_at_counter(client, shop):
    with Session(shop) as db:
        db.get(Student, 1).is_active = False
        db.commit()
    sign_in(client, "staff", "counter")
    assert client.post("/counter/orders", json=body().model_dump() | {"student_id": 1}).status_code == 403
