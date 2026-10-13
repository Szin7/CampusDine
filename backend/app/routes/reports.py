from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.auth import Principal, require_admin
from app.db import get_session
from app.models import Order
from app.schemas import SalesPeriod, SalesReport

router = APIRouter(prefix="/admin/reports", tags=["Sales reports"])


def sales_report(db: Session, start: date, end: date, monthly: bool = False) -> SalesReport:
    period_column = func.strftime("%Y-%m" if monthly else "%Y-%m-%d", Order.order_date)
    rows = db.execute(select(
        period_column.label("period"), func.count(Order.id).label("order_count"),
        func.sum(Order.total_amount).label("sales_amount"),
        func.sum(case((Order.payment_type == "wallet", Order.total_amount), else_=0)).label("wallet_sales"),
        func.sum(case((Order.payment_type == "credit", Order.total_amount), else_=0)).label("credit_sales"),
    ).where(Order.order_date >= start, Order.order_date <= end).group_by(period_column)).mappings().all()
    by_period = {row["period"]: SalesPeriod(**row) for row in rows}
    periods = []
    day = start
    while day <= end:
        key = f"{day.year:04d}-{day.month:02d}" if monthly else day.isoformat()
        periods.append(by_period.get(key, SalesPeriod(period=key, order_count=0, sales_amount=0, wallet_sales=0, credit_sales=0)))
        if monthly:
            if day.month == 12:
                break
            day = date(day.year, day.month + 1, 1)
        else:
            if day == end:
                break
            day += timedelta(days=1)
    return SalesReport(start_date=start, end_date=end, periods=periods,
                       order_count=sum(row.order_count for row in periods),
                       sales_amount=sum(row.sales_amount for row in periods),
                       wallet_sales=sum(row.wallet_sales for row in periods),
                       credit_sales=sum(row.credit_sales for row in periods))


@router.get("/daily", response_model=SalesReport)
def daily_sales(start_date: date, end_date: date, response: Response,
                user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    if end_date < start_date or (end_date - start_date).days > 365:
        raise HTTPException(422, "Choose a date range of 1 to 366 days, with the start no later than the end.")
    response.headers["Cache-Control"] = "no-store"
    return sales_report(db, start_date, end_date)


@router.get("/monthly", response_model=SalesReport)
def monthly_sales(response: Response, year: int = Query(ge=1900, le=9999),
                  user: Principal = Depends(require_admin), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    return sales_report(db, date(year, 1, 1), date(year, 12, 31), monthly=True)
