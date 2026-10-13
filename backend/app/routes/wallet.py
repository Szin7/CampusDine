from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Principal, require_student
from app.db import get_session
from app.models import CreditLedger, Student, WalletTransaction
from app.schemas import AccountSummary, CreditEntryView, WalletTransactionView

router = APIRouter(prefix="/wallet", tags=["Wallet and credit"])


def account_summary(student: Student) -> AccountSummary:
    return AccountSummary(student_id=student.id, roll_no=student.roll_no, name=student.name,
                          wallet_balance=student.wallet_balance, credit_balance=student.credit_balance,
                          credit_limit=student.credit_limit, remaining_credit=student.credit_limit - student.credit_balance)


@router.get("", response_model=AccountSummary)
def balances(response: Response, user: Principal = Depends(require_student)):
    response.headers["Cache-Control"] = "no-store"
    return account_summary(user.account)


@router.get("/transactions", response_model=list[WalletTransactionView])
def wallet_history(response: Response, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                   user: Principal = Depends(require_student), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    return db.scalars(select(WalletTransaction).where(WalletTransaction.student_id == user.account.id)
                      .order_by(WalletTransaction.timestamp.desc(), WalletTransaction.id.desc())
                      .offset(offset).limit(limit)).all()


@router.get("/credit", response_model=list[CreditEntryView])
def credit_history(response: Response, status: Literal["outstanding", "settled"] | None = None,
                   limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                   user: Principal = Depends(require_student), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    query = select(CreditLedger).where(CreditLedger.student_id == user.account.id)
    if status:
        query = query.where(CreditLedger.status == status)
    return db.scalars(query.order_by(CreditLedger.created_at.desc(), CreditLedger.id.desc())
                      .offset(offset).limit(limit)).all()
