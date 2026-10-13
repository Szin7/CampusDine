import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.face_matching import AmbiguousFaceMatch, FaceEngineUnavailable, match_student_encoding
from app.main import app
from app.models import Admin, Order, Staff, Student, utc_now
from app.routes import counter

PASSWORD = "counter-test-password"


def encoding(distance=0.0):
    vector = np.zeros(128, dtype="<f8")
    vector[0] = distance
    return vector.tobytes()


@pytest.fixture
def counter_client(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    with Session(engine) as db:
        admin = Admin(name="Accounts", username="accounts", password_hash=hash_password(PASSWORD))
        db.add(admin)
        db.flush()
        db.add(Staff(name="Counter", username="counter", password_hash=hash_password(PASSWORD)))
        for i, status, active in [(1, "approved", True), (2, "pending", True),
                                  (3, "approved", False), (4, "rejected", True)]:
            db.add(Student(roll_no=f"NCE-081-00{i}", name=f"Student {i}", department="Computer",
                           semester=3, email=f"student{i}@example.com", password_hash=hash_password(PASSWORD),
                           face_encoding=encoding(i), approval_status=status, is_active=active,
                           approved_by_admin_id=admin.id if status == "approved" else None,
                           approved_at=utc_now() if status == "approved" else None,
                           wallet_balance=20000))
        db.commit()
    monkeypatch.setattr(counter, "encode_face_photo", lambda data: encoding(1))
    with TestClient(app) as client:
        session = client.post("/auth/login", json={"role": "staff", "username": "counter", "password": PASSWORD})
        client.headers["X-CSRF-Token"] = session.json()["csrf_token"]
        yield client


def identify(client):
    return client.post("/counter/identify", files={"face_photo": ("capture.jpg", b"fixture", "image/jpeg")})


def test_match_and_lookup_do_not_charge(counter_client, migrated_db):
    result = identify(counter_client)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "matched"
    student = result.json()["student"]
    assert student["roll_no"] == "NCE-081-001"
    assert not {"email", "password_hash", "face_encoding"} & student.keys()
    fallback = counter_client.get("/counter/students", params={"roll_no": "nce-081-001"})
    assert fallback.json() == student
    assert result.headers["cache-control"] == "no-store"
    with Session(migrated_db[0]) as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 0
        assert db.get(Student, student["id"]).wallet_balance == 20000


@pytest.mark.parametrize("student_number", [2, 3, 4, 99])
def test_ineligible_students_not_identified(counter_client, monkeypatch, student_number):
    monkeypatch.setattr(counter, "encode_face_photo", lambda data: encoding(student_number))
    result = identify(counter_client).json()
    assert result["status"] == "not_found" and result["student"] is None
    assert counter_client.get("/counter/students", params={"roll_no": f"NCE-081-00{student_number}"}).status_code == 404


def test_ambiguous_match_requires_roll_lookup(counter_client, migrated_db):
    with Session(migrated_db[0]) as db:
        second = db.scalar(select(Student).where(Student.roll_no == "NCE-081-003"))
        second.is_active = True
        second.face_encoding = encoding(1.1)
        db.commit()
    result = identify(counter_client).json()
    assert result["status"] == "ambiguous" and result["student"] is None


@pytest.mark.parametrize("role,username", [("admin", "accounts"), ("student", "NCE-081-001")])
def test_counter_is_staff_only(counter_client, role, username):
    result = counter_client.post("/auth/login", json={"role": role, "username": username, "password": PASSWORD})
    counter_client.headers["X-CSRF-Token"] = result.json()["csrf_token"]
    assert identify(counter_client).status_code == 403
    assert counter_client.get("/counter/students", params={"roll_no": "NCE-081-001"}).status_code == 403


def test_counter_requires_login_and_csrf(counter_client):
    del counter_client.headers["X-CSRF-Token"]
    assert identify(counter_client).status_code == 403
    counter_client.cookies.clear()
    assert identify(counter_client).status_code == 401


def test_fallback_works_without_face_engine(counter_client, monkeypatch):
    def unavailable(data):
        raise FaceEngineUnavailable()
    monkeypatch.setattr(counter, "encode_face_photo", unavailable)
    assert identify(counter_client).status_code == 503
    assert counter_client.get("/counter/students", params={"roll_no": "NCE-081-001"}).status_code == 200


def test_matching_cutoff_and_corrupt_encodings():
    assert match_student_encoding(encoding(), [(1, encoding(0.5))]) == 1
    assert match_student_encoding(encoding(), [(1, encoding(0.5001))]) is None
    assert match_student_encoding(encoding(), []) is None
    assert match_student_encoding(encoding(), [(1, b"broken"), (2, encoding(float("nan"))), (3, encoding(0.1))]) == 3
    with pytest.raises(AmbiguousFaceMatch):
        match_student_encoding(encoding(), [(1, encoding(0.1)), (2, encoding(0.4))])
    with pytest.raises(ValueError):
        match_student_encoding(encoding(), [], tolerance=float("nan"))
