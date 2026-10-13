import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from threading import Lock
from time import monotonic

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Admin, LoginSession, Staff, Student, utc_now

COOKIE_NAME = "campusdine_session"
SESSION_SECONDS = 8 * 60 * 60
password_hasher = PasswordHasher()
DUMMY_HASH = password_hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return password_hasher.verify(stored_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AuthThrottle:
    def __init__(self):
        self.attempts = {}
        self.lock = Lock()

    def check(self, key: str, limit: int, seconds: int):
        now = monotonic()
        with self.lock:
            # One worker, a few thousand students. Revisit if this gets slow.
            self.attempts = {k: v for k, v in self.attempts.items() if v[1] > now}
            count, deadline = self.attempts.get(key, (0, now + seconds))
            if count >= limit or (key not in self.attempts and len(self.attempts) >= 10000):
                raise HTTPException(429, "Too many attempts. Try again shortly.", headers={"Retry-After": str(seconds)})
            self.attempts[key] = (count + 1, deadline)


def check_origin(request: Request):
    origin = request.headers.get("origin")
    if origin is not None and origin not in request.app.state.allowed_origins:
        raise HTTPException(403, "Request origin is not allowed.")


def throttle(request: Request, action: str, limit: int, seconds: int):
    host = request.client.host if request.client else "unknown"
    request.app.state.auth_throttle.check(f"{action}:{host}", limit, seconds)


@dataclass
class Principal:
    role: str
    account: Student | Staff | Admin
    login_session: LoginSession


def current_user(request: Request, csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
                 db: Session = Depends(get_session)) -> Principal:
    token = request.cookies.get(COOKIE_NAME, "")
    login_session = db.get(LoginSession, token_digest(token)) if token else None
    if login_session is None or login_session.expires_at <= utc_now():
        raise HTTPException(401, "Sign in to continue.")
    for role, model in (("student", Student), ("staff", Staff), ("admin", Admin)):
        account_id = getattr(login_session, f"{role}_id")
        if account_id is not None:
            account = db.get(model, account_id)
            break
    if account is None or not account.is_active:
        raise HTTPException(401, "This account is inactive.")
    if role == "student" and account.approval_status != "approved":
        raise HTTPException(403, "Enrollment has not been approved.")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        check_origin(request)
        if not secrets.compare_digest((csrf_token or "").encode(), login_session.csrf_token.encode()):
            raise HTTPException(403, "Missing or invalid CSRF token.")
    return Principal(role, account, login_session)


def require_admin(user: Principal = Depends(current_user)) -> Principal:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required.")
    return user


def require_student(user: Principal = Depends(current_user)) -> Principal:
    if user.role != "student":
        raise HTTPException(403, "Student access required.")
    return user


def require_staff(user: Principal = Depends(current_user)) -> Principal:
    if user.role != "staff":
        raise HTTPException(403, "Canteen staff access required.")
    return user


def start_session(db: Session, role: str, account_id: int, old_token: str | None):
    db.execute(delete(LoginSession).where(LoginSession.expires_at <= utc_now()))
    if old_token:
        db.execute(delete(LoginSession).where(LoginSession.token_hash == token_digest(old_token)))
    token = secrets.token_urlsafe(32)
    record = LoginSession(token_hash=token_digest(token), csrf_token=secrets.token_urlsafe(32),
                          expires_at=utc_now() + timedelta(seconds=SESSION_SECONDS),
                          **{f"{role}_id": account_id})
    db.add(record)
    return token, record
