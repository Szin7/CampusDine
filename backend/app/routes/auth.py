from anyio import from_thread

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (COOKIE_NAME, DUMMY_HASH, SESSION_SECONDS, Principal, check_origin,
                      current_user, token_digest, start_session, throttle, verify_password)
from app.db import get_session
from app.face_matching import (AmbiguousFaceMatch, FaceEngineUnavailable, InvalidFacePhoto,
                               MAX_PHOTO_BYTES, encode_face_photo, match_student_encoding)
from app.models import Admin, Staff, Student
from app.schemas import Login

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_session)):
    check_origin(request)
    throttle(request, f"login:{body.role}:{body.username.casefold()}", 20, 60)
    model = {"student": Student, "staff": Staff, "admin": Admin}[body.role]
    column = Student.roll_no if body.role == "student" else model.username
    account = db.scalar(select(model).where(column == body.username))
    valid = verify_password(body.password, account.password_hash if account else DUMMY_HASH)
    if not valid or account is None:
        raise HTTPException(401, "Incorrect username or password.")
    if not account.is_active:
        raise HTTPException(403, "This account is inactive. Contact the accounts office.")
    if body.role == "student" and account.approval_status != "approved":
        raise HTTPException(403, "Enrollment has not been approved.")
    return issue_session(request, response, db, body.role, account)


def issue_session(request, response, db, role, account):
    token, record = start_session(db, role, account.id, request.cookies.get(COOKIE_NAME))
    db.commit()
    old_token = request.cookies.get(COOKIE_NAME)
    if old_token:
        from_thread.run(request.app.state.order_hub.revoke_session, token_digest(old_token))
    response.set_cookie(COOKIE_NAME, token, max_age=SESSION_SECONDS, httponly=True,
                        secure=request.app.state.cookie_secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"role": role, "id": account.id, "name": account.name, "csrf_token": record.csrf_token}


@router.get("/methods")
def methods(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"student_face_login": request.app.state.student_face_login}


@router.post("/face-login")
def face_login(request: Request, response: Response, face_photo: UploadFile = File(),
               db: Session = Depends(get_session)):
    check_origin(request)
    if not request.app.state.student_face_login:
        raise HTTPException(403, "Face login is disabled. Use your roll number and password.")
    throttle(request, "face-login", 10, 60)
    # Bound anonymous encoding work across all callers as well as per address.
    request.app.state.auth_throttle.check("face-login:global", 60, 60)
    try:
        photo = face_photo.file.read(MAX_PHOTO_BYTES + 1)
    finally:
        face_photo.file.close()
    if len(photo) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo exceeds the 5 MB limit.")
    try:
        probe = encode_face_photo(photo)
    except InvalidFacePhoto as exc:
        raise HTTPException(422, str(exc)) from exc
    except FaceEngineUnavailable as exc:
        raise HTTPException(503, "Face recognition is unavailable. Use your roll number and password.") from exc
    # Encoding runs without a DB lock. Match against current enrollment data and
    # issue the session in one write transaction so suspension cannot race login.
    db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
    rows = db.execute(select(Student.id, Student.face_encoding).where(
        Student.approval_status == "approved", Student.is_active.is_(True),
        Student.face_encoding.is_not(None))).all()
    failure = "Face login could not verify an approved student. Try again or use your roll number and password."
    try:
        student_id = match_student_encoding(probe, rows, tolerance=request.app.state.face_tolerance)
    except AmbiguousFaceMatch:
        raise HTTPException(401, failure) from None
    if student_id is None:
        raise HTTPException(401, failure)
    return issue_session(request, response, db, "student", db.get(Student, student_id))


@router.get("/me")
def me(response: Response, user: Principal = Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    return {"role": user.role, "id": user.account.id, "name": user.account.name,
            "csrf_token": user.login_session.csrf_token}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user: Principal = Depends(current_user), db: Session = Depends(get_session)):
    db.delete(user.login_session)
    db.commit()
    from_thread.run(request.app.state.order_hub.revoke_session, user.login_session.token_hash)
    response.delete_cookie(COOKIE_NAME, path="/")
