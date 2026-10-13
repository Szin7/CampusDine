from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ordering
from app.auth import hash_password
from app.main import app
from app.models import Admin, LoginSession, MenuItem, Staff, Student, utc_now
from app.ordering import place_order
from app.schemas import CheckoutCreate

PASSWORD = "report-test-password"


@pytest.fixture
def reports_client(migrated_db, monkeypatch):
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
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                           wallet_balance=15000, credit_limit=100000))
        db.add_all([MenuItem(name="Veg momo", price=12000, category="Momo"),
                    MenuItem(name="Milk tea", price=3000, category="Drinks")])
        db.commit()
    for i, instant in enumerate([datetime(2026, 7, 31, 18, 14), datetime(2026, 7, 31, 18, 15), datetime(2026, 8, 3, 5)]):
        monkeypatch.setattr(ordering, "utc_now", lambda instant=instant: instant)
        items = [{"menu_item_id": 1, "quantity": 1}]
        if i == 0:
            items.append({"menu_item_id": 2, "quantity": 1})
        with Session(engine) as db:
            place_order(db, 1, CheckoutCreate(checkout_key=f"report-order-{i:04d}", expected_total=15000 if i == 0 else 12000, items=items))
            db.commit()
    with TestClient(app) as client:
        login(client)
        yield client, engine


def login(client, role="admin", username="accounts"):
    result = client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]


def test_daily_sales_local_dates_zero_days_and_no_duplicate_totals(reports_client):
    client, _ = reports_client
    response = client.get("/admin/reports/daily?start_date=2026-07-31&end_date=2026-08-03")
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["order_count"], result["sales_amount"], result["wallet_sales"], result["credit_sales"]) == (3, 39000, 15000, 24000)
    assert [(p["period"], p["sales_amount"]) for p in result["periods"]] == [
        ("2026-07-31", 15000), ("2026-08-01", 12000), ("2026-08-02", 0), ("2026-08-03", 12000)]
    assert (result["currency"], result["amount_unit"]) == ("NPR", "paisa")
    assert response.headers["Cache-Control"] == "no-store"


def test_monthly_sales_ignore_topups_settlements_and_menu_edits(reports_client):
    client, _ = reports_client
    url = "/admin/reports/monthly?year=2026"
    before = client.get(url).json()
    assert len(before["periods"]) == 12
    assert before["periods"][6]["sales_amount"] == 15000
    assert before["periods"][7]["sales_amount"] == 24000
    assert client.post("/admin/accounts/1/top-ups", json={"request_key": "report-topup-0001", "amount": 10000, "reference": "Receipt"}).status_code == 201
    assert client.post("/admin/billing/settlements", json={"request_key": "report-settlement-0001", "student_id": 1,
                       "ledger_ids": [1, 2], "expected_amount": 24000, "reference": "Accounts transfer"}).status_code == 201
    assert client.patch("/admin/menu/1", json={"price": 99000, "is_archived": True}).status_code == 200
    assert client.get(url).json() == before


def test_empty_report_and_invalid_ranges(reports_client):
    client, _ = reports_client
    empty = client.get("/admin/reports/daily?start_date=2025-01-01&end_date=2025-01-02").json()
    assert empty["sales_amount"] == 0 and len(empty["periods"]) == 2
    for query in ("start_date=2026-08-02&end_date=2026-08-01", "start_date=2020-01-01&end_date=2026-08-01"):
        assert client.get(f"/admin/reports/daily?{query}").status_code == 422
    assert client.get("/admin/reports/monthly?year=10000").status_code == 422


def test_profile_edit_and_search_preserve_financial_fields(reports_client):
    client, _ = reports_client
    before = client.get("/admin/students/1").json()
    changed = client.patch("/admin/students/1", json={"name": " Sujin Prajapati ", "semester": 4, "email": "NEW@example.com"})
    assert changed.status_code == 200
    assert changed.json()["name"] == "Sujin Prajapati"
    assert changed.json()["email"] == "new@example.com"
    for field in ("credit_balance", "credit_limit", "wallet_balance", "approval_status", "roll_no"):
        assert changed.json()[field] == before[field]
    assert client.get("/admin/students?status=all&q=sujin").json()[0]["id"] == 1
    assert client.get("/admin/students?status=all&q=nce-002").json()[0]["id"] == 2
    assert client.get("/admin/students?status=all&q=%25").json() == []


def test_suspension_revokes_old_sessions_even_after_reactivation(reports_client):
    client, engine = reports_client
    login(client, "student", "NCE-001")
    student_cookie = client.cookies.get("campusdine_session")
    # Sign in independently so admin login itself doesn't revoke the student session.
    response = client.post("/auth/login", json={"role": "admin", "username": "accounts", "password": PASSWORD}, headers={"Cookie": ""})
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    assert client.patch("/admin/students/1", json={"is_active": False}).status_code == 200
    with Session(engine) as db:
        assert db.scalar(select(LoginSession).where(LoginSession.student_id == 1)) is None
    assert client.get("/students/me", headers={"Cookie": f"campusdine_session={student_cookie}"}).status_code == 401
    assert client.patch("/admin/students/1", json={"is_active": True}).status_code == 200
    assert client.get("/students/me", headers={"Cookie": f"campusdine_session={student_cookie}"}).status_code == 401
    login(client, "student", "NCE-001")
    assert client.get("/students/me").status_code == 200


def test_conflicting_email_rolls_back_profile_changes(reports_client):
    client, _ = reports_client
    response = client.patch("/admin/students/1", json={"email": "s2@example.com", "is_active": False})
    assert response.status_code == 409
    profile = client.get("/admin/students/1").json()
    assert profile["email"] == "s1@example.com" and profile["is_active"] is True


@pytest.mark.parametrize("body", [{}, {"name": None}, {"semester": 9}, {"wallet_balance": 999},
                                  {"approval_status": "approved"}, {"face_encoding": "fake"}, {"roll_no": "NEW"}])
def test_profile_patch_has_a_limited_field_set(reports_client, body):
    client, _ = reports_client
    assert client.patch("/admin/students/1", json=body).status_code == 422


@pytest.mark.parametrize("role,username", [("student", "NCE-001"), ("staff", "counter")])
def test_reports_and_student_management_require_admin(reports_client, role, username):
    client, _ = reports_client
    login(client, role, username)
    assert client.get("/admin/reports/monthly?year=2026").status_code == 403
    assert client.get("/admin/students/1").status_code == 403
    assert client.patch("/admin/students/1", json={"is_active": False}).status_code == 403


def test_reactivation_does_not_approve_pending_enrollment(reports_client):
    client, engine = reports_client
    with Session(engine) as db:
        student = db.get(Student, 2)
        student.is_active, student.approval_status = False, "pending"
        db.commit()
    response = client.patch("/admin/students/2", json={"is_active": True})
    assert response.json()["approval_status"] == "pending"
    assert client.post("/auth/login", json={"role": "student", "username": "NCE-002", "password": PASSWORD}).status_code == 403
