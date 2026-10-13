from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Principal, require_staff, throttle
from app.db import get_session
from app.face_matching import (AmbiguousFaceMatch, FaceEngineUnavailable, InvalidFacePhoto,
                               MAX_PHOTO_BYTES, encode_face_photo, match_student_encoding)
from app.models import Student
from app.schemas import CounterStudent, IdentificationResult

router = APIRouter(prefix="/counter", tags=["Canteen counter"])


def eligible_students():
    return select(Student).where(Student.approval_status == "approved", Student.is_active.is_(True))


@router.get("/students", response_model=CounterStudent)
def lookup_student(response: Response,
                   roll_no: Annotated[str, Query(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9/-]+$")],
                   user: Principal = Depends(require_staff), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    student = db.scalar(eligible_students().where(Student.roll_no == roll_no))
    if student is None:
        raise HTTPException(404, "No active, approved student has this roll number.")
    return student


@router.post("/identify", response_model=IdentificationResult)
def identify_student(request: Request, response: Response,
                     face_photo: Annotated[UploadFile, File()],
                     user: Principal = Depends(require_staff), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    throttle(request, f"face:{user.account.id}", 30, 60)
    # Face encoding takes longer than the lookup. Release the auth snapshot first.
    db.rollback()
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
        raise HTTPException(503, "Face recognition is unavailable. Use the roll-number lookup.") from exc
    rows = db.execute(eligible_students().with_only_columns(Student.id, Student.face_encoding)
                      .where(Student.face_encoding.is_not(None))).all()
    try:
        student_id = match_student_encoding(probe, rows, tolerance=request.app.state.face_tolerance)
    except AmbiguousFaceMatch:
        return IdentificationResult(status="ambiguous", message="More than one student matched. Use the roll-number lookup.")
    if student_id is None:
        return IdentificationResult(status="not_found", message="No student matched. Try another capture or use the roll-number lookup.")
    student = db.get(Student, student_id)
    return IdentificationResult(status="matched", student=CounterStudent.model_validate(student),
                                message="Student identified. Confirm their details before placing an order.")
