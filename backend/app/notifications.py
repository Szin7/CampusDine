import logging
import os
import smtplib
import ssl
from dataclasses import dataclass
from datetime import timedelta
from email.message import EmailMessage
from uuid import uuid4

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import Notification, Order, Student, utc_now

logger = logging.getLogger(__name__)
LEASE_TIME = timedelta(minutes=5)


@dataclass(frozen=True)
class EmailSettings:
    host: str
    port: int
    sender: str
    username: str
    password: str
    security: str


def email_settings():
    if os.getenv("CAMPUSDINE_EMAIL_ENABLED", "false").lower() != "true":
        return None
    security = os.getenv("CAMPUSDINE_SMTP_SECURITY", "starttls")
    host = os.getenv("CAMPUSDINE_SMTP_HOST", "").strip()
    sender = os.getenv("CAMPUSDINE_EMAIL_FROM", "").strip()
    if security not in {"starttls", "ssl"} or not host or not sender or "@" not in sender:
        raise ValueError("Set an SMTP host, sender address and starttls or ssl security")
    if any(c in sender for c in "\r\n"):
        raise ValueError("Invalid sender address")
    port = int(os.getenv("CAMPUSDINE_SMTP_PORT", "465" if security == "ssl" else "587"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid SMTP port")
    username, password = os.getenv("CAMPUSDINE_SMTP_USERNAME", ""), os.getenv("CAMPUSDINE_SMTP_PASSWORD", "")
    if bool(username) != bool(password):
        raise ValueError("Set both SMTP username and password")
    return EmailSettings(host, port, sender, username, password, security)


def send_email(settings, recipient, subject, body, notification_id):
    message = EmailMessage()
    message["From"] = settings.sender
    message["To"] = recipient
    message["Subject"] = subject
    message["Message-ID"] = f"<campusdine-{notification_id}@{settings.sender.rsplit('@', 1)[1]}>"
    message.set_content(body)
    context = ssl.create_default_context()
    if settings.security == "ssl":
        transport = smtplib.SMTP_SSL(settings.host, settings.port, timeout=10, context=context)
    else:
        transport = smtplib.SMTP(settings.host, settings.port, timeout=10)
    with transport as smtp:
        if settings.security == "starttls":
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        if settings.username:
            smtp.login(settings.username, settings.password)
        refused = smtp.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def queue_ready(db: Session, order: Order):
    now = utc_now()
    notice = Notification(event_key=f"ready:{order.id}", student_id=order.student_id,
                          order_id=order.id, kind="order_ready", created_at=now, next_attempt_at=now,
                          subject=f"CampusDine: token {order.token_number} is ready",
                          body=f"Your order for {order.order_date.isoformat()}, token {order.token_number}, is ready.\n"
                               "Please collect it at the National College of Engineering canteen counter.\n")
    db.add(notice)
    db.flush()
    return notice.id


def due_condition(now):
    return or_(and_(Notification.status == "pending", Notification.next_attempt_at <= now),
               and_(Notification.status == "sending", Notification.lease_until <= now))


def deliver(engine, notification_id, settings):
    now, lease = utc_now(), uuid4().hex
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        notice = db.scalar(select(Notification).where(Notification.id == notification_id, due_condition(now)))
        if notice is None:
            return False
        student = db.get(Student, notice.student_id)
        order = db.get(Order, notice.order_id) if notice.order_id else None
        if (notice.kind == "order_ready" and (order is None or order.status != "ready")):
            notice.status = "skipped"
            notice.lease_token = notice.lease_until = None
            db.commit()
            return False
        recipient, subject, body = student.email, notice.subject, notice.body
        notice.status, notice.lease_token, notice.lease_until = "sending", lease, now + LEASE_TIME
        notice.attempts += 1
        db.commit()
    error = None
    try:
        # I release SQLite before touching SMTP; a slow mail server must not hold up checkout.
        send_email(settings, recipient, subject, body, notification_id)
    except Exception as exc:
        error = type(exc).__name__
        logger.warning("Notification %s delivery failed (%s)", notification_id, error)
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        notice = db.get(Notification, notification_id)
        if notice.lease_token != lease:
            return False
        notice.lease_token = notice.lease_until = None
        notice.last_error = error
        if error:
            notice.status = "pending"
            notice.next_attempt_at = utc_now() + timedelta(seconds=min(60 * 2**min(notice.attempts-1, 6), 3600))
        else:
            notice.status, notice.sent_at = "sent", utc_now()
        db.commit()
    return error is None


def deliver_now(engine, notification_id):
    try:
        settings = email_settings()
        if settings:
            deliver(engine, notification_id, settings)
    except Exception:
        # The event is already durable. Cron can recover even a failed background task.
        logger.exception("Notification %s deferred to retry worker", notification_id)


def retry_due(engine, limit=100):
    settings = email_settings()
    if settings is None:
        logger.warning("Email is disabled; queued notifications were not sent")
        return 0
    with Session(engine) as db:
        ids = db.scalars(select(Notification.id).where(due_condition(utc_now()))
                         .order_by(Notification.next_attempt_at, Notification.id).limit(limit)).all()
    return sum(deliver(engine, notice_id, settings) for notice_id in ids)
