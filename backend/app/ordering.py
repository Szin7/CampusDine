import hashlib
import json
from datetime import timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import NEPAL_TZ
from app.models import (CreditLedger, DailyTokenCounter, MenuItem, Order, OrderItem,
                        OrderStatusLog, Student, WalletTransaction, utc_now)
from app.schemas import CheckoutCreate, OrderItemView, OrderView


class CheckoutError(ValueError):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def place_order(db: Session, student_id: int, body: CheckoutCreate, *, staff_id: int | None = None) -> tuple[Order, bool]:
    if not db.in_transaction():
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
    elif db.connection().get_execution_options().get("sqlite_begin_mode") != "IMMEDIATE":
        raise RuntimeError("Checkout needs BEGIN IMMEDIATE before any reads.")

    student = db.get(Student, student_id)
    if student is None or not student.is_active or student.approval_status != "approved":
        raise CheckoutError("Student is not active and approved.", 403)
    fingerprint = hashlib.sha256(json.dumps({
        "items": sorted((item.menu_item_id, item.quantity) for item in body.items),
        "expected_total": body.expected_total, "staff_id": staff_id,
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    previous = db.scalar(select(Order).where(Order.student_id == student_id, Order.checkout_key == body.checkout_key))
    if previous is not None:
        if previous.request_fingerprint != fingerprint:
            raise CheckoutError("This checkout key was already used for a different order.")
        return previous, False

    quantities = {item.menu_item_id: item.quantity for item in body.items}
    menu = db.scalars(select(MenuItem).where(MenuItem.id.in_(quantities))).all()
    if len(menu) != len(quantities) or any(item.is_archived or not item.is_available for item in menu):
        raise CheckoutError("An item is no longer available. Refresh the menu and review your order.")
    total = sum(item.price * quantities[item.id] for item in menu)
    if total != body.expected_total:
        raise CheckoutError("Menu prices have changed. Review the updated total before ordering.")
    if student.wallet_balance >= total:
        payment_type = "wallet"
    elif student.credit_balance + total <= student.credit_limit:
        payment_type = "credit"
    else:
        raise CheckoutError("Insufficient wallet balance and remaining credit.")

    now = utc_now()
    day = now.replace(tzinfo=timezone.utc).astimezone(NEPAL_TZ).date()
    # I reserve the write lock before reading either money or the counter.
    # The token and debit stay in this transaction, so failure rolls both back.
    counter = db.get(DailyTokenCounter, day)
    if counter is None:
        counter = DailyTokenCounter(order_date=day, last_token=1)
        db.add(counter)
    else:
        counter.last_token += 1
    order = Order(student_id=student_id, token_number=counter.last_token, order_date=day,
                  status="received", total_amount=total, payment_type=payment_type,
                  checkout_key=body.checkout_key, request_fingerprint=fingerprint,
                  placed_by_staff_id=staff_id, created_at=now)
    db.add(order)
    db.flush()
    for item in menu:
        db.add(OrderItem(order_id=order.id, menu_item_id=item.id, item_name=item.name,
                         unit_price=item.price, quantity=quantities[item.id]))
    if payment_type == "wallet":
        student.wallet_balance -= total
        db.add(WalletTransaction(student_id=student_id, order_id=order.id, amount=-total,
                                 type="order_debit", timestamp=now))
    else:
        student.credit_balance += total
        db.add(CreditLedger(student_id=student_id, order_id=order.id, amount=total,
                            status="outstanding", month=day.strftime("%Y-%m"), created_at=now))
    db.add(OrderStatusLog(order_id=order.id, status="received", changed_at=now, changed_by_staff_id=staff_id))
    db.flush()
    return order, True


def order_view(db: Session, order: Order) -> OrderView:
    return order_views(db, [order])[0]


NEXT_STATUS = {"received": "preparing", "preparing": "ready", "ready": "collected"}


class OrderStatusError(ValueError):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def advance_order(db: Session, order_id: int, expected_status: str, status: str, staff_id: int) -> tuple[Order, bool]:
    if not db.in_transaction():
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
    elif db.connection().get_execution_options().get("sqlite_begin_mode") != "IMMEDIATE":
        raise RuntimeError("Status changes need BEGIN IMMEDIATE before any reads.")
    order = db.get(Order, order_id)
    if order is None:
        raise OrderStatusError("Order not found.", 404)
    if NEXT_STATUS.get(expected_status) != status:
        raise OrderStatusError("Advance one step: Received → Preparing → Ready → Collected.")
    # Two counter tablets can click the same button. A repeat must not skip a stage.
    if order.status == status:
        return order, False
    if order.status != expected_status:
        raise OrderStatusError(f"Order is already {order.status}. Reload its current status.")
    order.status = status
    db.add(OrderStatusLog(order_id=order.id, status=status, changed_at=utc_now(), changed_by_staff_id=staff_id))
    db.flush()
    return order, True


def order_views(db: Session, orders: list[Order]) -> list[OrderView]:
    if not orders:
        return []
    items_by_order = {order.id: [] for order in orders}
    items = db.scalars(select(OrderItem).where(OrderItem.order_id.in_(items_by_order)).order_by(OrderItem.id)).all()
    for item in items:
        items_by_order[item.order_id].append(OrderItemView.model_validate(item))
    revisions = dict(db.execute(select(OrderStatusLog.order_id, func.max(OrderStatusLog.id))
                                .where(OrderStatusLog.order_id.in_(items_by_order)).group_by(OrderStatusLog.order_id)).all())
    student_ids = {order.student_id for order in orders}
    names = dict(db.execute(select(Student.id, Student.name).where(Student.id.in_(student_ids))).all())
    return [OrderView(revision=revisions.get(order.id, 0), id=order.id, student_id=order.student_id, student_name=names[order.student_id],
                      token_number=order.token_number, order_date=order.order_date, status=order.status,
                      total_amount=order.total_amount, payment_type=order.payment_type, created_at=order.created_at,
                      items=items_by_order[order.id]) for order in orders]
