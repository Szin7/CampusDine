"""Real authentication/DB flow with only the expensive image encoder replaced."""
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, hash_password, token_digest
from app.face_matching import FaceEngineUnavailable, InvalidFacePhoto, MAX_PHOTO_BYTES
from app.main import app
from app.models import Admin, LoginSession, Student, utc_now
from app.routes import auth


def encoding(value=1):
    vector = np.zeros(128, dtype='<f8')
    vector[0] = value
    return vector.tobytes()


@pytest.fixture
def client(migrated_db, monkeypatch):
    monkeypatch.setenv('CAMPUSDINE_STUDENT_FACE_LOGIN', 'true')
    monkeypatch.setenv('CAMPUSDINE_COOKIE_SECURE', 'false')
    with Session(migrated_db[0]) as db:
        password = hash_password('face-test-password')
        admin = Admin(name='Accounts', username='accounts', password_hash=password)
        db.add(admin)
        db.flush()
        for number, status, active in [(1, 'approved', True), (2, 'pending', True),
                                       (3, 'approved', False), (4, 'rejected', True)]:
            db.add(Student(name=f'Student {number}', roll_no=f'FACE-{number}',
                           department='Computer', semester=3, email=f'face{number}@example.com',
                           password_hash=password, face_encoding=encoding(number),
                           approval_status=status, is_active=active,
                           approved_by_admin_id=admin.id if status == 'approved' else None,
                           approved_at=utc_now() if status == 'approved' else None))
        db.commit()
    monkeypatch.setattr(auth, 'encode_face_photo', lambda data: encoding())
    with TestClient(app) as browser:
        yield browser


def login(client, **kwargs):
    return client.post('/auth/face-login', files={'face_photo': ('capture.jpg', b'fake-image', 'image/jpeg')}, **kwargs)


def test_face_session_cookie_csrf_and_logout(client):
    result = login(client)
    assert result.status_code == 200
    assert result.headers['cache-control'] == 'no-store'
    cookie = result.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie
    assert result.json()['role'] == 'student'
    assert result.json()['name'] == 'Student 1'
    assert client.get('/auth/me').json() == result.json()
    assert client.get('/admin/students').status_code == 403
    assert client.post('/auth/logout').status_code == 403
    assert client.post('/auth/logout', headers={'X-CSRF-Token': result.json()['csrf_token']}).status_code == 204
    assert client.get('/auth/me').status_code == 401


@pytest.mark.parametrize('number', [2, 3, 4, 99])
def test_unapproved_inactive_unknown_have_same_failure(client, monkeypatch, migrated_db, number):
    monkeypatch.setattr(auth, 'encode_face_photo', lambda data: encoding(number))
    result = login(client)
    assert result.status_code == 401
    assert result.json()['detail'] == 'Face login could not verify an approved student. Try again or use your roll number and password.'
    assert 'set-cookie' not in result.headers
    with Session(migrated_db[0]) as db:
        assert db.scalar(select(func.count()).select_from(LoginSession)) == 0


def test_ambiguous_match_never_logs_in(client, migrated_db):
    with Session(migrated_db[0]) as db:
        second = db.scalar(select(Student).where(Student.roll_no == 'FACE-3'))
        second.is_active = True
        second.face_encoding = encoding(1.1)
        db.commit()
    assert login(client).status_code == 401
    assert client.get('/auth/me').status_code == 401


def test_disabled_and_password_fallback(client):
    app.state.student_face_login = False
    assert client.get('/auth/methods').json() == {'student_face_login': False}
    assert login(client).status_code == 403
    result = client.post('/auth/login', json={'role': 'student', 'username': 'FACE-1', 'password': 'face-test-password'})
    assert result.status_code == 200


def test_disabled_by_default(migrated_db, monkeypatch):
    monkeypatch.delenv('CAMPUSDINE_STUDENT_FACE_LOGIN', raising=False)
    with TestClient(app) as browser:
        assert browser.get('/auth/methods').json() == {'student_face_login': False}
        assert login(browser).status_code == 403


def test_origin_and_attempt_limit_checked_before_encoding(client, monkeypatch):
    calls = []
    monkeypatch.setattr(auth, 'encode_face_photo', lambda data: calls.append(data) or encoding(99))
    assert login(client, headers={'Origin': 'https://untrusted.example'}).status_code == 403
    assert not calls
    for _ in range(10):
        assert login(client).status_code == 401
    result = login(client)
    assert result.status_code == 429 and result.headers['Retry-After'] == '60'
    assert len(calls) == 10


def test_global_encoding_limit(client, monkeypatch):
    for _ in range(60):
        app.state.auth_throttle.check('face-login:global', 60, 60)
    def unexpected(data):
        pytest.fail('Rate-limited request reached encoder')
    monkeypatch.setattr(auth, 'encode_face_photo', unexpected)
    assert login(client).status_code == 429


@pytest.mark.parametrize('exception,status', [(InvalidFacePhoto('Exactly one face required.'), 422), (FaceEngineUnavailable(), 503)])
def test_encoder_failures_do_not_authenticate(client, monkeypatch, exception, status):
    def fail(data):
        raise exception
    monkeypatch.setattr(auth, 'encode_face_photo', fail)
    assert login(client).status_code == status
    assert client.get('/auth/me').status_code == 401


def test_oversized_upload_not_encoded(client, monkeypatch):
    def unexpected(data):
        pytest.fail('Oversized photo reached encoder')
    monkeypatch.setattr(auth, 'encode_face_photo', unexpected)
    assert client.post('/auth/face-login', files={'face_photo': ('large.jpg', b'x' * (MAX_PHOTO_BYTES + 1), 'image/jpeg')}).status_code == 413


def test_suspension_during_encoding_is_seen_without_write_lock(client, migrated_db, monkeypatch):
    def encode_and_suspend(data):
        with Session(migrated_db[0]) as db:
            db.scalar(select(Student).where(Student.roll_no == 'FACE-1')).is_active = False
            db.commit()
        return encoding()
    monkeypatch.setattr(auth, 'encode_face_photo', encode_and_suspend)
    assert login(client).status_code == 401


def test_face_login_rotates_existing_session(client, migrated_db):
    old = client.post('/auth/login', json={'role': 'admin', 'username': 'accounts', 'password': 'face-test-password'})
    old_token = client.cookies[COOKIE_NAME]
    result = login(client)
    assert result.json()['role'] == 'student'
    assert result.json()['csrf_token'] != old.json()['csrf_token']
    assert client.cookies[COOKIE_NAME] != old_token
    with Session(migrated_db[0]) as db:
        assert db.get(LoginSession, token_digest(old_token)) is None


def test_secure_cookie_setting_applies(client):
    app.state.cookie_secure = True
    assert '; Secure' in login(client).headers['set-cookie']
