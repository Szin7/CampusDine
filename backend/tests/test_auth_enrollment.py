from datetime import timedelta
from io import BytesIO
import sys
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, hash_password, token_digest, verify_password
from app.face_matching import InvalidFacePhoto, encode_face_photo
from app.main import app
from app.models import Admin, LoginSession, Staff, Student, utc_now
from app.routes import students

PASSWORD = "canteen-test-password"
FORM = dict(roll_no="nce-081-001", name="Sujin", department="Computer Engineering",
            semester="3", email="sujin@example.com", password=PASSWORD)


@pytest.fixture
def client(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    with Session(engine) as db:
        db.add_all([Admin(name="Accounts", username="accounts", password_hash=hash_password(PASSWORD)),
                    Staff(name="Counter", username="counter", password_hash=hash_password(PASSWORD))])
        db.commit()
    monkeypatch.setattr(students, "encode_face_photo", lambda data: bytes(1024))
    with TestClient(app) as client:
        yield client


def enroll(client, **changes):
    return client.post("/students/enroll", data=FORM | changes,
                       files={"face_photo": ("face.jpg", b"photo fixture", "image/jpeg")})


def login(client, role="admin", username="accounts", password=PASSWORD):
    return client.post("/auth/login", json=dict(role=role, username=username, password=password))


def approve(client, student_id):
    result = login(client)
    return client.post(f"/admin/students/{student_id}/approval", json={"decision": "approve"},
                       headers={"X-CSRF-Token": result.json()["csrf_token"]})


def test_enrollment_approval_login_logout(client, migrated_db):
    response = enroll(client)
    assert response.status_code == 201, response.text
    profile = response.json()
    assert profile["approval_status"] == "pending"
    assert profile["roll_no"] == "NCE-081-001"
    assert "password_hash" not in profile and "face_encoding" not in profile
    assert login(client, "student", FORM["roll_no"]).status_code == 403
    assert approve(client, profile["id"]).status_code == 200
    result = login(client, "student", FORM["roll_no"])
    assert result.status_code == 200
    assert "HttpOnly" in result.headers["set-cookie"]
    assert client.get("/students/me").json()["id"] == profile["id"]
    token = client.cookies.get(COOKIE_NAME)
    engine, _ = migrated_db
    with Session(engine) as db:
        stored = db.get(Student, profile["id"])
        assert stored.password_hash != PASSWORD and verify_password(PASSWORD, stored.password_hash)
        assert db.get(LoginSession, token_digest(token)) is not None
        assert db.get(LoginSession, token) is None
    assert client.post("/auth/logout").status_code == 403
    assert client.post("/auth/logout", headers={"X-CSRF-Token": result.json()["csrf_token"]}).status_code == 204
    assert client.get("/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, token)
    assert client.get("/auth/me").status_code == 401


def test_duplicate_enrollment(client):
    assert enroll(client).status_code == 201
    assert enroll(client, roll_no=FORM["roll_no"].upper()).status_code == 409


@pytest.mark.parametrize("field,value", [("semester", "9"), ("email", "bad"), ("password", "short"), ("name", "   ")])
def test_enrollment_validation(client, field, value):
    assert enroll(client, **{field: value}).status_code == 422


def test_wrong_role_cannot_approve(client):
    student_id = enroll(client).json()["id"]
    session = login(client, "staff", "counter").json()
    assert client.get("/admin/students").status_code == 403
    assert client.post(f"/admin/students/{student_id}/approval", json={"decision": "approve"},
                       headers={"X-CSRF-Token": session["csrf_token"]}).status_code == 403
    approve(client, student_id)
    login(client, "student", FORM["roll_no"])
    assert client.get("/admin/students").status_code == 403


def test_rejection_and_repeat_approval(client):
    student_id = enroll(client).json()["id"]
    session = login(client).json()
    headers = {"X-CSRF-Token": session["csrf_token"]}
    url = f"/admin/students/{student_id}/approval"
    assert client.post(url, json={"decision": "reject"}, headers=headers).status_code == 200
    assert client.post(url, json={"decision": "approve"}, headers=headers).status_code == 409
    assert login(client, "student", FORM["roll_no"]).status_code == 403


def test_expiry_and_disabled_account(client, migrated_db):
    login(client)
    engine, _ = migrated_db
    with Session(engine) as db:
        record = db.scalar(select(LoginSession))
        record.expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
    assert client.get("/auth/me").status_code == 401
    login(client)
    with Session(engine) as db:
        db.scalar(select(Admin)).is_active = False
        db.commit()
    assert client.get("/auth/me").status_code == 401


def test_staff_creation_and_csrf_origin(client):
    token = login(client).json()["csrf_token"]
    body = dict(name="Lunch counter", username="lunch", password=PASSWORD)
    assert client.post("/admin/staff", json=body).status_code == 403
    assert client.post("/admin/staff", json=body, headers={"X-CSRF-Token": token, "Origin": "https://evil.example"}).status_code == 403
    response = client.post("/admin/staff", json=body, headers={"X-CSRF-Token": token})
    assert response.status_code == 201
    assert "password_hash" not in response.json()
    assert login(client, "staff", "lunch").status_code == 200


def test_bad_login_and_throttle(client):
    assert login(client, password="incorrect").status_code == 401
    assert login(client, username="missing").status_code == 401
    for _ in range(19):
        login(client, password="incorrect")
    assert login(client).status_code == 429


def test_encoding_failure_is_not_an_enrollment(client, monkeypatch, migrated_db):
    def fail(data):
        raise InvalidFacePhoto("Exactly one face required")
    monkeypatch.setattr(students, "encode_face_photo", fail)
    assert enroll(client).status_code == 422
    with Session(migrated_db[0]) as db:
        assert db.scalar(select(Student)) is None


def test_photo_decoding_and_encoding_contract(monkeypatch):
    photo = BytesIO()
    Image.new("RGB", (100, 100)).save(photo, "PNG")
    engine = SimpleNamespace(face_locations=lambda pixels, model: [(0, 80, 80, 0)],
                             face_encodings=lambda *a, **k: [np.arange(128)])
    monkeypatch.setitem(sys.modules, "face_recognition", engine)
    encoded = encode_face_photo(photo.getvalue())
    assert np.array_equal(np.frombuffer(encoded, dtype="<f8"), np.arange(128))
    engine.face_locations = lambda pixels, model: []
    with pytest.raises(InvalidFacePhoto, match="exactly one"):
        encode_face_photo(photo.getvalue())
    engine.face_locations = lambda pixels, model: [(0, 1, 1, 0)] * 2
    with pytest.raises(InvalidFacePhoto, match="exactly one"):
        encode_face_photo(photo.getvalue())
    with pytest.raises(InvalidFacePhoto):
        encode_face_photo(b"not an image")


def test_login_rotates_session_and_sets_secure_cookie(client, migrated_db):
    login(client)
    old_token = client.cookies.get(COOKIE_NAME)
    app.state.cookie_secure = True
    response = login(client)
    assert "Secure" in response.headers["set-cookie"]
    with Session(migrated_db[0]) as db:
        assert db.get(LoginSession, token_digest(old_token)) is None


def test_missing_face_engine_returns_unavailable(client, monkeypatch):
    from app.face_matching import FaceEngineUnavailable
    def unavailable(data):
        raise FaceEngineUnavailable("Face enrollment is unavailable on this server.")
    monkeypatch.setattr(students, "encode_face_photo", unavailable)
    assert enroll(client).status_code == 503


def test_oversized_photo_rejected(client):
    response = client.post("/students/enroll", data=FORM,
                           files={"face_photo": ("large.jpg", b"x" * (5 * 1024 * 1024 + 1), "image/jpeg")})
    assert response.status_code == 413
