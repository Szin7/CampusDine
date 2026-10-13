from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, JSON,
    LargeBinary, String, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utc_now() -> datetime:
    # SQLite stores naive datetimes; every timestamp in this database is UTC.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    username: Mapped[str] = mapped_column(String(80, collation="NOCASE"), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean(create_constraint=True), default=True, server_default="1")


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    username: Mapped[str] = mapped_column(String(80, collation="NOCASE"), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean(create_constraint=True), default=True, server_default="1")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        CheckConstraint("semester BETWEEN 1 AND 8", name="ck_student_semester"),
        CheckConstraint("typeof(wallet_balance) = 'integer' AND wallet_balance >= 0", name="ck_student_wallet"),
        CheckConstraint("typeof(credit_limit) = 'integer' AND credit_limit >= 0", name="ck_student_credit_limit"),
        CheckConstraint("typeof(credit_balance) = 'integer' AND credit_balance >= 0 AND credit_balance <= credit_limit", name="ck_student_credit_balance"),
        CheckConstraint("approval_status IN ('pending', 'approved', 'rejected')", name="ck_student_approval"),
        CheckConstraint("face_encoding IS NULL OR length(face_encoding) = 1024", name="ck_face_encoding_length"),
        CheckConstraint("approval_status != 'approved' OR (approved_by_admin_id IS NOT NULL AND approved_at IS NOT NULL AND face_encoding IS NOT NULL)", name="ck_student_approved_fields"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    roll_no: Mapped[str] = mapped_column(String(40, collation="NOCASE"), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    department: Mapped[str] = mapped_column(String(100))
    semester: Mapped[int] = mapped_column(Integer)
    email: Mapped[str] = mapped_column(String(254, collation="NOCASE"), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    face_encoding: Mapped[bytes | None] = mapped_column(LargeBinary)
    wallet_balance: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    credit_limit: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    credit_balance: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    approval_status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    is_active: Mapped[bool] = mapped_column(Boolean(create_constraint=True), default=True, server_default="1")
    approved_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class MenuItem(Base):
    __tablename__ = "menu_items"
    __table_args__ = (
        CheckConstraint("typeof(price) = 'integer' AND price > 0", name="ck_menu_price"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    price: Mapped[int] = mapped_column(Integer)
    category: Mapped[str] = mapped_column(String(50))
    is_available: Mapped[bool] = mapped_column(Boolean(create_constraint=True), default=True, server_default="1")
    is_archived: Mapped[bool] = mapped_column(Boolean(create_constraint=True), default=False, server_default="0")


class DailyTokenCounter(Base):
    __tablename__ = "daily_token_counters"
    __table_args__ = (
        CheckConstraint("typeof(last_token) = 'integer' AND last_token >= 0", name="ck_last_token"),
    )

    order_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_token: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("order_date", "token_number", name="uq_order_daily_token"),
        UniqueConstraint("student_id", "checkout_key", name="uq_order_checkout"),
        CheckConstraint("typeof(token_number) = 'integer' AND token_number > 0", name="ck_order_token"),
        CheckConstraint("typeof(total_amount) = 'integer' AND total_amount > 0", name="ck_order_total"),
        CheckConstraint("status IN ('received', 'preparing', 'ready', 'collected')", name="ck_order_status"),
        CheckConstraint("payment_type IN ('wallet', 'credit')", name="ck_order_payment"),
        Index("ix_orders_queue", "order_date", "status"),
        Index("ix_orders_student_created", "student_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    token_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="received", server_default="received")
    order_date: Mapped[date] = mapped_column(Date)
    total_amount: Mapped[int] = mapped_column(Integer)
    payment_type: Mapped[str] = mapped_column(String(10))
    checkout_key: Mapped[str] = mapped_column(String(64))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    placed_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "menu_item_id", name="uq_order_item"),
        CheckConstraint("typeof(quantity) = 'integer' AND quantity > 0", name="ck_item_quantity"),
        CheckConstraint("typeof(unit_price) = 'integer' AND unit_price > 0", name="ck_item_price"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    item_name: Mapped[str] = mapped_column(String(120))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"
    __table_args__ = (
        CheckConstraint("typeof(amount) = 'integer'", name="ck_wallet_integer"),
        UniqueConstraint("request_key", name="uq_wallet_request_key"),
        CheckConstraint("(type = 'top_up' AND amount > 0 AND admin_id IS NOT NULL AND order_id IS NULL) OR (type = 'order_debit' AND amount < 0 AND order_id IS NOT NULL AND admin_id IS NULL)", name="ck_wallet_transaction_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(20))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), unique=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    reference: Mapped[str | None] = mapped_column(String(120))
    request_key: Mapped[str | None] = mapped_column(String(64))
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class CreditLedger(Base):
    __tablename__ = "credit_ledger"
    __table_args__ = (
        CheckConstraint("typeof(amount) = 'integer' AND amount > 0", name="ck_credit_amount"),
        CheckConstraint("status IN ('outstanding', 'settled')", name="ck_credit_status"),
        CheckConstraint("month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(month, 6, 2) BETWEEN '01' AND '12'", name="ck_credit_month"),
        CheckConstraint("(status = 'outstanding' AND settled_at IS NULL AND settled_by_admin_id IS NULL AND settlement_reference IS NULL) OR (status = 'settled' AND settled_at IS NOT NULL AND settled_by_admin_id IS NOT NULL AND settlement_reference IS NOT NULL)", name="ck_credit_settlement"),
        Index("ix_credit_outstanding", "status", "month", "student_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="outstanding", server_default="outstanding")
    month: Mapped[str] = mapped_column(String(7))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime)
    settled_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    settlement_reference: Mapped[str | None] = mapped_column(String(120))


class OrderStatusLog(Base):
    __tablename__ = "order_status_log"
    __table_args__ = (
        CheckConstraint("status IN ('received', 'preparing', 'ready', 'collected')", name="ck_log_status"),
        CheckConstraint("status = 'received' OR changed_by_staff_id IS NOT NULL", name="ck_log_staff_actor"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    status: Mapped[str] = mapped_column(String(16))
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    changed_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))


class LoginSession(Base):
    __tablename__ = "login_sessions"
    __table_args__ = (
        CheckConstraint("(student_id IS NOT NULL) + (staff_id IS NOT NULL) + (admin_id IS NOT NULL) = 1", name="ck_session_one_account"),
    )

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id"), index=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), index=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class CreditLimitChange(Base):
    __tablename__ = "credit_limit_changes"
    __table_args__ = (
        CheckConstraint("typeof(old_limit) = 'integer' AND old_limit >= 0", name="ck_old_credit_limit"),
        CheckConstraint("typeof(new_limit) = 'integer' AND new_limit >= 0", name="ck_new_credit_limit"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    old_limit: Mapped[int] = mapped_column(Integer)
    new_limit: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(120))
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class BillingSettlement(Base):
    __tablename__ = "billing_settlements"
    __table_args__ = (
        CheckConstraint("typeof(amount) = 'integer' AND amount > 0", name="ck_settlement_amount"),
    )

    request_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("admins.id"))
    amount: Mapped[int] = mapped_column(Integer)
    ledger_ids: Mapped[list[int]] = mapped_column(JSON)
    reference: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class RecommendationBatch(Base):
    __tablename__ = "recommendation_batch"
    __table_args__ = (CheckConstraint("id = 1", name="ck_recommendation_single_batch"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime)
    source_max_order_id: Mapped[int] = mapped_column(Integer)


class RecommendationScore(Base):
    __tablename__ = "recommendation_scores"
    __table_args__ = (CheckConstraint("score > 0 AND score <= 1", name="ck_recommendation_score"),)

    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), primary_key=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"), primary_key=True)
    history_last_order_id: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("kind IN ('order_ready', 'monthly_dues')", name="ck_notification_kind"),
        CheckConstraint("status IN ('pending', 'sending', 'sent', 'skipped')", name="ck_notification_status"),
        CheckConstraint("attempts >= 0", name="ck_notification_attempts"),
        Index("ix_notification_due", "status", "next_attempt_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_key: Mapped[str] = mapped_column(String(100), unique=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    kind: Mapped[str] = mapped_column(String(20))
    subject: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String(12), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    lease_token: Mapped[str | None] = mapped_column(String(32))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(String(100))
