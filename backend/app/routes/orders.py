from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import Principal, current_user, require_staff, require_student
from app.db import get_session
from app.models import Order, OrderStatusLog
from app.ordering import (CheckoutError, OrderStatusError, advance_order, order_view, order_views, place_order)
from app.schemas import (CheckoutCreate, CounterCheckoutCreate, OrderView, OrderStatusUpdate, OrderStatusView, StaffQueue)

from app.realtime import publish_order
from app.notifications import queue_ready, deliver_now

router = APIRouter(tags=["Orders"])


def checkout(request: Request, db: Session, student_id: int, body: CheckoutCreate, response: Response, staff_id: int | None = None):
    try:
        order, created = place_order(db, student_id, body, staff_id=staff_id)
        view = order_view(db, order)
        db.commit()
    except CheckoutError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
    if created:
        publish_order(request, view)
    response.status_code = 201 if created else 200
    response.headers["Cache-Control"] = "no-store"
    return view


@router.post("/orders", response_model=OrderView, status_code=201)
def student_checkout(body: CheckoutCreate, request: Request, response: Response, user: Principal = Depends(require_student),
                     db: Session = Depends(get_session)):
    return checkout(request, db, user.account.id, body, response)


@router.post("/counter/orders", response_model=OrderView, status_code=201)
def counter_checkout(body: CounterCheckoutCreate, request: Request, response: Response, user: Principal = Depends(require_staff),
                     db: Session = Depends(get_session)):
    return checkout(request, db, body.student_id, body, response, staff_id=user.account.id)


@router.get("/orders", response_model=list[OrderView])
def my_orders(response: Response, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
              user: Principal = Depends(require_student), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    orders = db.scalars(select(Order).where(Order.student_id == user.account.id)
                        .order_by(Order.created_at.desc(), Order.id.desc()).offset(offset).limit(limit)).all()
    return order_views(db, orders)


@router.get("/orders/{order_id}", response_model=OrderView)
def get_order(order_id: int, response: Response, user: Principal = Depends(current_user),
              db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    order = db.get(Order, order_id)
    if order is None or (user.role == "student" and order.student_id != user.account.id):
        raise HTTPException(404, "Order not found.")
    return order_view(db, order)


@router.get("/staff/orders", response_model=StaffQueue)
def staff_queue(response: Response, status: Literal["received", "preparing", "ready"] | None = None,
                limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0),
                user: Principal = Depends(require_staff), db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    conditions = [Order.status.in_(("received", "preparing", "ready"))]
    if status:
        conditions.append(Order.status == status)
    total = db.scalar(select(func.count()).select_from(Order).where(*conditions))
    orders = db.scalars(select(Order).where(*conditions).order_by(Order.created_at, Order.id)
                        .offset(offset).limit(limit)).all()
    return StaffQueue(orders=order_views(db, orders), total=total, limit=limit, offset=offset)


@router.patch("/staff/orders/{order_id}/status", response_model=OrderView)
def change_status(order_id: int, body: OrderStatusUpdate, request: Request, response: Response, background_tasks: BackgroundTasks,
                  user: Principal = Depends(require_staff), db: Session = Depends(get_session)):
    try:
        order, changed = advance_order(db, order_id, body.expected_status, body.status, user.account.id)
        notice_id = queue_ready(db, order) if changed and order.status == "ready" else None
        view = order_view(db, order)
        db.commit()
    except OrderStatusError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
    if changed:
        publish_order(request, view)
    if notice_id is not None:
        background_tasks.add_task(deliver_now, request.app.state.db_engine, notice_id)
    response.headers["Cache-Control"] = "no-store"
    return view


@router.get("/orders/{order_id}/status-history", response_model=list[OrderStatusView])
def status_history(order_id: int, response: Response, user: Principal = Depends(current_user),
                   db: Session = Depends(get_session)):
    response.headers["Cache-Control"] = "no-store"
    order = db.get(Order, order_id)
    if order is None or (user.role == "student" and order.student_id != user.account.id):
        raise HTTPException(404, "Order not found.")
    return db.scalars(select(OrderStatusLog).where(OrderStatusLog.order_id == order_id)
                      .order_by(OrderStatusLog.id)).all()
