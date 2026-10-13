from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.main import app
from app.models import Admin, MenuItem, Order, OrderItem, Staff, Student, utc_now

PASSWORD = "menu-test-password"


@pytest.fixture
def menu_client(migrated_db, monkeypatch):
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    with Session(migrated_db[0]) as db:
        admin = Admin(name="Accounts", username="accounts", password_hash=hash_password(PASSWORD))
        db.add(admin)
        db.flush()
        db.add_all([
            Staff(name="Counter", username="counter", password_hash=hash_password(PASSWORD)),
            Student(roll_no="NCE-081-001", name="Sujin", department="Computer", semester=3,
                    email="sujin@example.com", password_hash=hash_password(PASSWORD),
                    approval_status="approved", approved_by_admin_id=admin.id,
                    approved_at=utc_now(), face_encoding=bytes(1024)),
        ])
        db.commit()
    with TestClient(app) as client:
        sign_in(client, "admin", "accounts")
        yield client


def sign_in(client, role, username):
    result = client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]


def create_item(client, **overrides):
    return client.post("/admin/menu", json={"name": "Veg momo", "price": 12000, "category": "Momo"} | overrides)


def test_archive_keeps_order_history(menu_client, migrated_db):
    item_id = create_item(menu_client).json()["id"]
    with Session(migrated_db[0]) as db:
        order = Order(student_id=1, token_number=1, order_date=date(2026, 9, 27),
                      total_amount=12000, payment_type="wallet", checkout_key="history", request_fingerprint="a"*64)
        db.add(order)
        db.flush()
        line = OrderItem(order_id=order.id, menu_item_id=item_id, item_name="Veg momo", unit_price=12000, quantity=1)
        db.add(line)
        db.commit()
        line_id = line.id
    changed = menu_client.patch(f"/admin/menu/{item_id}", json={"name": "Steamed veg momo", "price": 13000, "is_archived": True})
    assert changed.status_code == 200
    assert changed.json()["is_available"] is False
    assert menu_client.get("/menu").json() == []
    assert menu_client.get(f"/menu/{item_id}").status_code == 404
    assert len(menu_client.get("/admin/menu?include_archived=true").json()) == 1
    with Session(migrated_db[0]) as db:
        line = db.get(OrderItem, line_id)
        assert (line.item_name, line.unit_price) == ("Veg momo", 12000)
        assert db.get(MenuItem, item_id) is not None
    assert menu_client.patch(f"/admin/menu/{item_id}", json={"is_available": True}).status_code == 409
    restored = menu_client.patch(f"/admin/menu/{item_id}", json={"is_archived": False})
    assert restored.json()["is_available"] is False
    assert menu_client.patch(f"/admin/menu/{item_id}", json={"is_available": True}).status_code == 200


def test_browsing_shows_sold_out_and_filters(menu_client):
    create_item(menu_client)
    create_item(menu_client, name="Chicken momo", is_available=False)
    create_item(menu_client, name="Milk tea", category="Drinks", price=3000)
    sign_in(menu_client, "student", "NCE-081-001")
    response = menu_client.get("/menu")
    assert [x["name"] for x in response.json()] == ["Milk tea", "Chicken momo", "Veg momo"]
    assert response.headers["cache-control"] == "no-store"
    assert len(menu_client.get("/menu?category=momo").json()) == 2
    assert [x["name"] for x in menu_client.get("/menu?category=momo&available_only=true").json()] == ["Veg momo"]
    assert menu_client.get("/menu?limit=1&offset=1").json()[0]["name"] == "Chicken momo"


@pytest.mark.parametrize("role,username", [("student", "NCE-081-001"), ("staff", "counter")])
def test_menu_writes_require_admin(menu_client, role, username):
    item_id = create_item(menu_client).json()["id"]
    sign_in(menu_client, role, username)
    assert menu_client.get("/menu").status_code == 200
    assert menu_client.get("/admin/menu").status_code == 403
    assert create_item(menu_client).status_code == 403
    assert menu_client.patch(f"/admin/menu/{item_id}", json={"price": 1}).status_code == 403


@pytest.mark.parametrize("price", [0, -1, 120.5, "12000", True, 2**63])
def test_prices_are_positive_integer_paisa(menu_client, price):
    assert create_item(menu_client, price=price).status_code == 422


@pytest.mark.parametrize("changes", [{}, {"price": None}, {"name": "  "}, {"category": " "}, {"id": 99}, {"is_available": "yes"}])
def test_invalid_patch_rejected(menu_client, changes):
    item_id = create_item(menu_client).json()["id"]
    assert menu_client.patch(f"/admin/menu/{item_id}", json=changes).status_code == 422
    assert menu_client.get(f"/menu/{item_id}").json()["price"] == 12000


def test_menu_requires_session_and_write_csrf(menu_client):
    del menu_client.headers["X-CSRF-Token"]
    assert create_item(menu_client).status_code == 403
    menu_client.cookies.clear()
    assert menu_client.get("/menu").status_code == 401
