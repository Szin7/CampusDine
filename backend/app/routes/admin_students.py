from typing import Literal

from anyio import from_thread

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import Principal, hash_password, require_admin
from app.db import get_session
from app.models import LoginSession, Staff, Student, utc_now
from app.schemas import ApprovalDecision, StaffCreate, StaffView, StudentView, StudentUpdate

router = APIRouter(prefix="/admin", tags=["Admin enrollment"])


@router.get("/students", response_model=list[StudentView])
def list_students(response: Response, status: Literal["pending", "approved", "rejected", "all"] = "pending",
                  q: str | None = Query(None, min_length=1, max_length=120), is_active: bool | None = None,
                  limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
                  user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    query = select(Student)
    if status != "all":
        query = query.where(Student.approval_status == status)
    if is_active is not None:
        query = query.where(Student.is_active == is_active)
    if q is not None:
        query = query.where(or_(Student.roll_no.icontains(q.strip(), autoescape=True),
                                Student.name.icontains(q.strip(), autoescape=True)))
    return db.scalars(query.order_by(Student.created_at, Student.id).offset(offset).limit(limit)).all()


@router.post("/students/{student_id}/approval", response_model=StudentView)
def decide_enrollment(student_id: int, body: ApprovalDecision,
                      user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found.")
    if student.approval_status != "pending":
        raise HTTPException(409, "This enrollment has already been reviewed.")
    if body.decision == "approve":
        if student.face_encoding is None:
            raise HTTPException(409, "A valid enrollment face photo is required.")
        student.approval_status = "approved"
        student.approved_at = utc_now()
        student.approved_by_admin_id = user.account.id
    else:
        student.approval_status = "rejected"
    db.commit()
    return student


@router.post("/staff", response_model=StaffView, status_code=201)
def create_staff(body: StaffCreate, user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    staff = Staff(name=body.name, username=body.username.lower(), password_hash=hash_password(body.password))
    db.add(staff)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "This staff username is already registered.") from exc
    return staff


@router.get("/students/{student_id}", response_model=StudentView)
def get_student(student_id: int, response: Response, user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found.")
    return student


@router.patch("/students/{student_id}", response_model=StudentView)
def update_student(student_id: int, body: StudentUpdate, request: Request, response: Response,
                   user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found.")
    changes = body.model_dump(exclude_unset=True)
    if "email" in changes:
        changes["email"] = str(changes["email"]).lower()
    for field, value in changes.items():
        setattr(student, field, value)
    if changes.get("is_active") is False:
        # Reactivating an account must not bring its old browser sessions back.
        with db.no_autoflush:
            db.execute(delete(LoginSession).where(LoginSession.student_id == student_id))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "That email address is already registered.") from exc
    if changes.get("is_active") is False:
        from_thread.run(request.app.state.order_hub.revoke_student, student_id)
    return student
