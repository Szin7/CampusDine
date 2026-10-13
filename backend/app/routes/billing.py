import csv
from io import StringIO
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import Principal, require_admin
from app.db import get_session
from app.models import BillingSettlement, CreditLedger, Student, utc_now
from app.schemas import OutstandingDues, SettlementCreate, SettlementView

router = APIRouter(prefix="/admin/billing", tags=["Accounts billing"])
MonthFilter = Annotated[str | None, Query(pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$")]


def outstanding_rows(db: Session, month: str | None) -> list[OutstandingDues]:
    query = select(CreditLedger, Student).join(Student, CreditLedger.student_id == Student.id).where(CreditLedger.status == "outstanding")
    if month:
        query = query.where(CreditLedger.month == month)
    rows = db.execute(query.order_by(CreditLedger.month, Student.roll_no, CreditLedger.id)).all()
    grouped = {}
    for entry, student in rows:
        key = (student.id, entry.month)
        if key not in grouped:
            grouped[key] = OutstandingDues(student_id=student.id, roll_no=student.roll_no, name=student.name,
                                          department=student.department, month=entry.month, amount=0, ledger_ids=[])
        grouped[key].amount += entry.amount
        grouped[key].ledger_ids.append(entry.id)
    return list(grouped.values())


@router.get("/outstanding", response_model=list[OutstandingDues])
def outstanding(response: Response, month: MonthFilter = None, user: Principal = Depends(require_admin),
                db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    return outstanding_rows(db, month)


def csv_text(value: str) -> str:
    # Names come from enrollment; keep spreadsheet apps from treating them as formulas.
    stripped = value.lstrip()
    if stripped.startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")):
        return "'" + value
    return value


@router.get("/outstanding.csv", response_class=Response)
def export_outstanding(month: MonthFilter = None, user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["student_id", "roll_no", "name", "department", "month", "outstanding_paisa", "outstanding_npr", "ledger_ids"])
    for row in outstanding_rows(db, month):
        writer.writerow([row.student_id, csv_text(row.roll_no), csv_text(row.name), csv_text(row.department), row.month,
                         row.amount, f"{row.amount // 100}.{row.amount % 100:02d}", ";".join(map(str, row.ledger_ids))])
    return Response(content=output.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="campusdine-dues-{month or "all"}.csv"',
                             "Cache-Control": "no-store"})


@router.post("/settlements", response_model=SettlementView, status_code=201)
def settle_entries(body: SettlementCreate, response: Response, user: Principal = Depends(require_admin),
                   db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    ids = sorted(body.ledger_ids)
    previous = db.get(BillingSettlement, body.request_key)
    if previous:
        if (previous.student_id, previous.amount, previous.ledger_ids, previous.reference, previous.admin_id) != (
            body.student_id, body.expected_amount, ids, body.reference, user.account.id
        ):
            raise HTTPException(409, "This request key was already used for a different settlement.")
        response.status_code = 200
        return previous
    student = db.get(Student, body.student_id)
    if student is None:
        raise HTTPException(404, "Student not found.")
    entries = db.scalars(select(CreditLedger).where(CreditLedger.id.in_(ids))).all()
    if len(entries) != len(ids) or any(entry.student_id != student.id or entry.status != "outstanding" for entry in entries):
        raise HTTPException(409, "Some entries are missing, already settled, or belong to another student. Review the dues again.")
    total = sum(entry.amount for entry in entries)
    if total != body.expected_amount:
        raise HTTPException(409, "The selected dues do not match the confirmed amount.")
    outstanding_total = db.scalar(select(func.coalesce(func.sum(CreditLedger.amount), 0))
                                  .where(CreditLedger.student_id == student.id, CreditLedger.status == "outstanding"))
    if outstanding_total != student.credit_balance:
        raise HTTPException(409, "Credit balance and ledger disagree. Reconcile the account before settlement.")
    now = utc_now()
    # Settle the reviewed IDs, not every open entry: lunch orders may have arrived after export.
    for entry in entries:
        entry.status = "settled"
        entry.settled_at = now
        entry.settled_by_admin_id = user.account.id
        entry.settlement_reference = body.reference
    student.credit_balance -= total
    receipt = BillingSettlement(request_key=body.request_key, student_id=student.id, admin_id=user.account.id,
                                amount=total, ledger_ids=ids, reference=body.reference, created_at=now)
    db.add(receipt)
    db.commit()
    return receipt


@router.get("/settlements", response_model=list[SettlementView])
def settlement_history(response: Response, student_id: int | None = Query(None, gt=0),
                       limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                       user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    query = select(BillingSettlement)
    if student_id is not None:
        query = query.where(BillingSettlement.student_id == student_id)
    return db.scalars(query.order_by(BillingSettlement.created_at.desc(), BillingSettlement.request_key)
                      .offset(offset).limit(limit)).all()
