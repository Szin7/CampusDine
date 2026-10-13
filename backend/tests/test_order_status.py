from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.main import app
from app.models import Admin, MenuItem, Order, OrderStatusLog, Staff, Student, utc_now
from app.ordering import place_order
from app.schemas import CheckoutCreate

PASSWORD = "queue-test-password"


@pytest.fixture
def queue(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    hashed = hash_password(PASSWORD)
    with Session(engine) as db:
        admin = Admin(name="Accounts", username="accounts", password_hash=hashed)
        db.add(admin)
        db.flush()
        db.add_all([Staff(name="Morning counter", username="morning", password_hash=hashed),
                    Staff(name="Lunch counter", username="lunch", password_hash=hashed)])
        for i in (1, 2):
            db.add(Student(roll_no=f"NCE-00{i}", name=f"Student {i}", department="Computer", semester=3,
                           email=f"s{i}@example.com", password_hash=hashed, approval_status="approved",
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024), wallet_balance=100000))
        db.add(MenuItem(name="Veg momo", price=12000, category="Momo"))
        db.commit()
    with Session(engine) as db:
        place_order(db, 1, CheckoutCreate(checkout_key="queue-order-00001", expected_total=12000,
                                         items=[{"menu_item_id": 1, "quantity": 1}]))
        db.commit()
    with TestClient(app) as client:
        login(client)
        yield client, engine


def login(client, role="staff", username="morning"):
    result = client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]


def advance(client, expected, target, order_id=1):
    return client.patch(f"/staff/orders/{order_id}/status", json={"expected_status": expected, "status": target})


def test_full_progression_and_history(queue):
    client, engine = queue
    for expected, target in [("received", "preparing"), ("preparing", "ready"), ("ready", "collected")]:
        result = advance(client, expected, target)
        assert result.status_code == 200 and result.json()["status"] == target
        assert advance(client, expected, target).status_code == 200
    assert client.get("/staff/orders").json()["total"] == 0
    history = client.get("/orders/1/status-history").json()
    assert [x["status"] for x in history] == ["received", "preparing", "ready", "collected"]
    assert [x["changed_by_staff_id"] for x in history] == [None, 1, 1, 1]
    assert all(x["changed_at"].endswith("+00:00") for x in history)
    with Session(engine) as db:
        assert db.get(Student, 1).wallet_balance == 88000


@pytest.mark.parametrize("expected,target", [("received", "ready"), ("received", "collected"),
                                            ("preparing", "received"), ("received", "received"),
                                            ("collected", "received")])
def test_skips_and_backwards_changes_rejected(queue, expected, target):
    client, engine = queue
    assert advance(client, expected, target).status_code == 409
    with Session(engine) as db:
        assert db.get(Order, 1).status == "received"
        assert db.scalar(select(func.count()).select_from(OrderStatusLog)) == 1


def test_stale_click_does_not_move_order_back(queue):
    client, _ = queue
    advance(client, "received", "preparing")
    advance(client, "preparing", "ready")
    assert advance(client, "received", "preparing").status_code == 409
    assert client.get("/orders/1").json()["status"] == "ready"
    assert advance(client, "ready", "collected", order_id=999).status_code == 404


def test_concurrent_staff_clicks_log_once(queue):
    client, engine = queue
    morning_cookie = client.cookies.get("campusdine_session")
    # Keep the first browser session while signing in as the other staff member.
    login_result = client.post("/auth/login", json={"role": "staff", "username": "lunch", "password": PASSWORD},
                               headers={"Cookie": ""})
    lunch_cookie = client.cookies.get("campusdine_session")
    lunch_csrf = login_result.json()["csrf_token"]
    morning_csrf = client.headers["X-CSRF-Token"]
    barrier = Barrier(2)
    def submit(pair):
        cookie, csrf = pair
        barrier.wait(timeout=10)
        return client.patch("/staff/orders/1/status", json={"expected_status": "received", "status": "preparing"},
                            headers={"Cookie": f"campusdine_session={cookie}", "X-CSRF-Token": csrf})
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, [(morning_cookie, morning_csrf), (lunch_cookie, lunch_csrf)]))
    assert [r.status_code for r in results] == [200, 200]
    with Session(engine) as db:
        logs = db.scalars(select(OrderStatusLog).where(OrderStatusLog.status == "preparing")).all()
        assert len(logs) == 1 and logs[0].changed_by_staff_id in {1, 2}


def test_queue_keeps_uncollected_orders_from_previous_day(queue):
    client, engine = queue
    with Session(engine) as db:
        order = db.get(Order, 1)
        order.created_at -= timedelta(days=1)
        order.order_date -= timedelta(days=1)
        db.commit()
    result = client.get("/staff/orders?status=received&limit=1").json()
    assert result["total"] == 1 and result["orders"][0]["id"] == 1
    assert result["orders"][0]["items"][0]["item_name"] == "Veg momo"
    assert client.get("/staff/orders?status=ready").json()["orders"] == []
    assert client.get("/staff/orders?offset=1").json()["total"] == 1
    assert client.get("/staff/orders?offset=1").json()["orders"] == []


@pytest.mark.parametrize("role,username", [("student", "NCE-001"), ("admin", "accounts")])
def test_only_staff_can_advance_and_read_queue(queue, role, username):
    client, _ = queue
    login(client, role, username)
    assert advance(client, "received", "preparing").status_code == 403
    assert client.get("/staff/orders").status_code == 403


def test_student_history_is_private_and_status_requires_csrf(queue):
    client, _ = queue
    del client.headers["X-CSRF-Token"]
    assert advance(client, "received", "preparing").status_code == 403
    login(client, "student", "NCE-002")
    assert client.get("/orders/1/status-history").status_code == 404
    login(client, "student", "NCE-001")
    assert client.get("/orders/1/status-history").status_code == 200


def test_status_and_audit_log_roll_back_together(queue):
    client, engine = queue
    with engine.begin() as conn:
        conn.exec_driver_sql("""CREATE TRIGGER fail_status BEFORE INSERT ON order_status_log
                               BEGIN SELECT RAISE(ABORT, 'test log failure'); END""")
    with pytest.raises(IntegrityError):
        advance(client, "received", "preparing")
    with Session(engine) as db:
        assert db.get(Order, 1).status == "received"
        assert db.scalar(select(func.count()).select_from(OrderStatusLog)) == 1
