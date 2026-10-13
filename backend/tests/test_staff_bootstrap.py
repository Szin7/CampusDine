import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import verify_password
from app.models import Staff
from scripts import create_staff


def test_staff_bootstrap_hashes_password_and_refuses_duplicate(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setattr('sys.argv', ['create_staff', '--name', 'Counter operator', '--username', 'Counter'])
    monkeypatch.setattr(create_staff, 'getpass', lambda prompt: 'test-staff-password')
    create_staff.main()
    with Session(engine) as db:
        staff = db.scalar(select(Staff))
        assert staff.username == 'counter'
        assert staff.password_hash != 'test-staff-password'
        assert verify_password('test-staff-password', staff.password_hash)
    with pytest.raises(SystemExit) as result:
        create_staff.main()
    assert result.value.code == 1
    with Session(engine) as db:
        assert len(db.scalars(select(Staff)).all()) == 1


def test_staff_bootstrap_mismatch_creates_nothing(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setattr('sys.argv', ['create_staff', '--name', 'Counter operator', '--username', 'counter'])
    answers = iter(['test-staff-password', 'different-password'])
    monkeypatch.setattr(create_staff, 'getpass', lambda prompt: next(answers))
    with pytest.raises(SystemExit):
        create_staff.main()
    with Session(engine) as db:
        assert db.scalar(select(Staff)) is None
