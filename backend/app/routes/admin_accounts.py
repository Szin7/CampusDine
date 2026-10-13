from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Principal, require_admin
from app.db import get_session
from app.models import CreditLedger, CreditLimitChange, Student, WalletTransaction
from app.routes.wallet import account_summary
from app.schemas import (AccountSummary, CreditEntryView, CreditLimitChangeView, CreditLimitUpdate,
                         WalletTopUp, WalletTransactionView)

router = APIRouter(prefix="/admin/accounts", tags=["Admin accounts"])


def find_student(db: Session, student_id: int) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found.")
    return student


@router.get("/{student_id}", response_model=AccountSummary)
def balances(student_id: int, response: Response, user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    return account_summary(find_student(db, student_id))


@router.post("/{student_id}/top-ups", response_model=WalletTransactionView, status_code=201)
def top_up(student_id: int, body: WalletTopUp, response: Response,
           user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    previous = db.scalar(select(WalletTransaction).where(WalletTransaction.request_key == body.request_key))
    if previous:
        if (previous.student_id, previous.amount, previous.reference, previous.admin_id) != (
            student_id, body.amount, body.reference, user.account.id
        ):
            raise HTTPException(409, "This request key was already used for a different top-up.")
        response.status_code = 200
        return previous
    student = find_student(db, student_id)
    if student.approval_status != "approved" or not student.is_active:
        raise HTTPException(409, "Only active, approved student accounts can be topped up.")
    if student.wallet_balance + body.amount > 2_147_483_647:
        raise HTTPException(409, "This top-up would exceed the supported wallet balance.")
    # get_session holds the same write lock used by checkout. A retry sees the receipt.
    student.wallet_balance += body.amount
    transaction = WalletTransaction(student_id=student_id, amount=body.amount, type="top_up",
                                    admin_id=user.account.id, reference=body.reference, request_key=body.request_key)
    db.add(transaction)
    db.commit()
    return transaction


@router.patch("/{student_id}/credit-limit", response_model=AccountSummary)
def set_credit_limit(student_id: int, body: CreditLimitUpdate, response: Response,
                     user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    student = find_student(db, student_id)
    if student.approval_status != "approved":
        raise HTTPException(409, "Approve the enrollment before setting a credit limit.")
    if student.credit_limit != body.expected_credit_limit:
        raise HTTPException(409, "The credit limit has changed. Reload the account before editing.")
    if body.credit_limit < student.credit_balance:
        raise HTTPException(409, "The credit limit cannot be lower than outstanding credit.")
    if body.credit_limit != student.credit_limit:
        db.add(CreditLimitChange(student_id=student_id, admin_id=user.account.id, old_limit=student.credit_limit,
                                 new_limit=body.credit_limit, reason=body.reason))
        student.credit_limit = body.credit_limit
    db.commit()
    return account_summary(student)


@router.get("/{student_id}/wallet-transactions", response_model=list[WalletTransactionView])
def wallet_history(student_id: int, response: Response, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                   user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    find_student(db, student_id)
    return db.scalars(select(WalletTransaction).where(WalletTransaction.student_id == student_id)
                      .order_by(WalletTransaction.timestamp.desc(), WalletTransaction.id.desc()).offset(offset).limit(limit)).all()


@router.get("/{student_id}/credit-ledger", response_model=list[CreditEntryView])
def credit_history(student_id: int, response: Response, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                   user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    find_student(db, student_id)
    return db.scalars(select(CreditLedger).where(CreditLedger.student_id == student_id)
                      .order_by(CreditLedger.created_at.desc(), CreditLedger.id.desc()).offset(offset).limit(limit)).all()


@router.get("/{student_id}/credit-limit-history", response_model=list[CreditLimitChangeView])
def limit_history(student_id: int, response: Response, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                  user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    find_student(db, student_id)
    return db.scalars(select(CreditLimitChange).where(CreditLimitChange.student_id == student_id)
                      .order_by(CreditLimitChange.changed_at.desc(), CreditLimitChange.id.desc()).offset(offset).limit(limit)).all()
