"""Recover an account from the server console during a maintenance window."""
import argparse
from getpass import getpass

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import database_path
from app.db import make_engine
from app.models import Admin, LoginSession, Staff, Student
from app.schemas import Password


def reset_password(engine, role: str, username: str, password: str) -> int:
    models = {"student": Student, "staff": Staff, "admin": Admin}
    if role not in models:
        raise ValueError("Choose student, staff or admin.")
    password = TypeAdapter(Password).validate_python(password)
    model = models[role]
    identifier = Student.roll_no if role == "student" else model.username
    password_hash = hash_password(password)
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        account = db.scalar(select(model).where(identifier == username.strip()))
        if account is None:
            raise ValueError("Account not found. Check the role and username or roll number.")
        account.password_hash = password_hash
        db.execute(delete(LoginSession).where(getattr(LoginSession, f"{role}_id") == account.id))
        db.commit()
        return account.id


def main():
    parser = argparse.ArgumentParser(description="Reset a password and revoke that account's sessions. Stop the API first.")
    parser.add_argument("--role", required=True, choices=("student", "staff", "admin"))
    parser.add_argument("--username", required=True, help="Student roll number or staff/admin username")
    parser.add_argument("--api-stopped", action="store_true", required=True,
                        help="Confirm the API is stopped so existing WebSockets are closed")
    args = parser.parse_args()
    path = database_path()
    if not path.is_file():
        parser.exit(1, "Database not found. Check CAMPUSDINE_DB_PATH; no database was created.\n")
    password = getpass("New password (12–128 characters): ")
    if password != getpass("Confirm new password: "):
        parser.exit(1, "Passwords did not match. No changes made.\n")
    engine = make_engine(path)
    try:
        account_id = reset_password(engine, args.role, args.username, password)
    except ValidationError:
        parser.exit(1, "Password must contain 12–128 characters. No changes made.\n")
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    finally:
        engine.dispose()
    print(f"Password reset for {args.role} account {account_id}. Existing sessions revoked. Restart the API.")


if __name__ == "__main__":
    main()
