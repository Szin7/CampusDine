import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password, start_session, verify_password
from app.main import app
from app.models import Admin, Staff, Student, LoginSession
from scripts import reset_password

OLD = 'old-account-password'
NEW = 'new-account-password'


@pytest.fixture
def accounts(migrated_db):
    engine, _ = migrated_db
    with Session(engine) as db:
        hashed = hash_password(OLD)
        admin = Admin(name='Accounts', username='accounts', password_hash=hashed)
        staff = Staff(name='Counter', username='counter', password_hash=hashed)
        student = Student(name='Student', roll_no='NCE-001', department='Computer', semester=3,
                          email='student@example.com', password_hash=hashed)
        db.add_all([admin, staff, student]); db.flush()
        for role, account in [('admin', admin), ('staff', staff), ('student', student)]:
            start_session(db, role, account.id, None)
        db.commit()
    return engine


@pytest.mark.parametrize('role,username,model', [('admin', 'ACCOUNTS', Admin), ('staff', 'counter', Staff), ('student', 'nce-001', Student)])
def test_recovery_changes_only_target_and_revokes_sessions(accounts, role, username, model):
    reset_password.reset_password(accounts, role, username, NEW)
    with Session(accounts) as db:
        account = db.scalar(select(model))
        assert verify_password(NEW, account.password_hash)
        assert not verify_password(OLD, account.password_hash)
        assert db.scalar(select(LoginSession).where(getattr(LoginSession, f'{role}_id') == account.id)) is None
        assert len(db.scalars(select(LoginSession)).all()) == 2
        student = db.scalar(select(Student))
        assert student.approval_status == 'pending'
        assert student.wallet_balance == student.credit_balance == 0


def test_invalid_password_and_unknown_account_make_no_changes(accounts):
    with pytest.raises(ValidationError):
        reset_password.reset_password(accounts, 'admin', 'accounts', 'short')
    with pytest.raises(ValueError, match='Account not found'):
        reset_password.reset_password(accounts, 'admin', 'missing', NEW)
    with Session(accounts) as db:
        assert verify_password(OLD, db.scalar(select(Admin)).password_hash)
        assert len(db.scalars(select(LoginSession)).all()) == 3


def test_old_session_and_password_are_rejected(accounts, monkeypatch):
    monkeypatch.setenv('CAMPUSDINE_COOKIE_SECURE', 'false')
    with TestClient(app) as client:
        assert client.post('/auth/login', json={'role': 'staff', 'username': 'counter', 'password': OLD}).status_code == 200
        reset_password.reset_password(accounts, 'staff', 'counter', NEW)
        assert client.get('/auth/me').status_code == 401
        assert client.post('/auth/login', json={'role': 'staff', 'username': 'counter', 'password': OLD}).status_code == 401
        assert client.post('/auth/login', json={'role': 'staff', 'username': 'counter', 'password': NEW}).status_code == 200


def test_cli_mismatch_leaves_account_unchanged(accounts, monkeypatch):
    monkeypatch.setattr('sys.argv', ['reset_password', '--role', 'admin', '--username', 'accounts', '--api-stopped'])
    values = iter([NEW, OLD])
    monkeypatch.setattr(reset_password, 'getpass', lambda _: next(values))
    with pytest.raises(SystemExit) as result:
        reset_password.main()
    assert result.value.code == 1
    with Session(accounts) as db:
        assert verify_password(OLD, db.scalar(select(Admin)).password_hash)


def test_cli_requires_maintenance_confirmation(accounts, monkeypatch):
    monkeypatch.setattr('sys.argv', ['reset_password', '--role', 'admin', '--username', 'accounts'])
    with pytest.raises(SystemExit) as result:
        reset_password.main()
    assert result.value.code == 2


def test_cli_does_not_create_missing_database(tmp_path, monkeypatch):
    missing = tmp_path / 'missing.sqlite3'
    monkeypatch.setenv('CAMPUSDINE_DB_PATH', str(missing))
    monkeypatch.setattr('sys.argv', ['reset_password', '--role', 'admin', '--username', 'accounts', '--api-stopped'])
    with pytest.raises(SystemExit):
        reset_password.main()
    assert not missing.exists()


def test_api_errors_are_not_cached(accounts):
    with TestClient(app) as client:
        for path in ['/auth/me', '/students/me', '/orders']:
            response = client.get(path)
            assert response.status_code == 401
            assert response.headers['cache-control'] == 'no-store'
            assert response.headers['x-content-type-options'] == 'nosniff'
