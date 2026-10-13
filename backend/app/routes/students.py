from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import EmailStr

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import Principal, check_origin, hash_password, require_student, throttle
from app.db import get_session
from app.face_matching import (FaceEngineUnavailable, InvalidFacePhoto, MAX_PHOTO_BYTES,
                               encode_face_photo)
from app.models import Student
from app.schemas import StudentView, ShortText, Password

router = APIRouter(prefix="/students", tags=["Students"])


@router.post("/enroll", response_model=StudentView, status_code=201)
def enroll(request: Request,
           roll_no: Annotated[str, Form(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9/-]+$")],
           name: Annotated[ShortText, Form()],
           department: Annotated[ShortText, Form(max_length=100)],
           semester: Annotated[int, Form(ge=1, le=8)],
           email: Annotated[EmailStr, Form()],
           password: Annotated[Password, Form()],
           face_photo: Annotated[UploadFile, File()], db: Session = Depends(get_session)):
    check_origin(request)
    throttle(request, "enroll", 10, 600)
    try:
        photo = face_photo.file.read(MAX_PHOTO_BYTES + 1)
    finally:
        face_photo.file.close()
    if len(photo) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo exceeds the 5 MB limit.")
    try:
        encoding = encode_face_photo(photo)
    except InvalidFacePhoto as exc:
        raise HTTPException(422, str(exc)) from exc
    except FaceEngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    student = Student(roll_no=roll_no.upper(), name=name,
                      department=department, semester=semester,
                      email=str(email).lower(), password_hash=hash_password(password),
                      face_encoding=encoding)
    db.add(student)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "This roll number or email is already registered.") from exc
    return student


@router.get("/me", response_model=StudentView)
def profile(user: Principal = Depends(require_student)):
    return user.account
