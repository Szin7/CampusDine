from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import notifications as mail
from app.jobs.monthly_billing import queue_monthly_dues
from app.models import Notification, Order, Student, utc_now
from app.routes import orders as order_routes
from test_billing import billing_client, SETTLEMENT
from test_websocket import sockets, place, advance

SETTINGS = mail.EmailSettings("smtp.example.test", 587, "canteen@example.test", "user", "secret", "starttls")


@pytest.fixture
def fake_mail(monkeypatch):
    sent = []
    monkeypatch.setattr(mail, "email_settings", lambda: SETTINGS)
    monkeypatch.setattr(mail, "send_email", lambda *args: sent.append(args))
    return sent


def ready(sockets):
    client, auth, engine = sockets
    assert place(client, auth["NCE-001"]).status_code == 201
    assert advance(client, auth["counter"], "received", "preparing").status_code == 200
    return client, auth, engine


def test_ready_commits_and_broadcasts_before_email_once(sockets, fake_mail, monkeypatch):
    client, auth, engine = ready(sockets)
    events = []
    monkeypatch.setattr(order_routes, "publish_order", lambda *args: events.append("broadcast"))
    def send(*args):
        with Session(engine) as db:
            assert db.get(Order, 1).status == "ready"
        events.append("email")
        fake_mail.append(args)
    monkeypatch.setattr(mail, "send_email", send)
    assert advance(client, auth["counter"], "preparing", "ready").status_code == 200
    assert events == ["broadcast", "email"]
    assert advance(client, auth["counter"], "preparing", "ready").status_code == 200
    assert len(fake_mail) == 1
    with Session(engine) as db:
        notice = db.scalar(select(Notification))
        assert notice.status == "sent" and notice.attempts == 1
        assert notice.sent_at is not None


def test_outbox_insert_failure_rolls_back_status(sockets, fake_mail):
    client, auth, engine = ready(sockets)
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TRIGGER fail_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
    with pytest.raises(IntegrityError):
        advance(client, auth["counter"], "preparing", "ready")
    with Session(engine) as db:
        assert db.get(Order, 1).status == "preparing"
        assert db.scalar(select(func.count()).select_from(Notification)) == 0
    assert fake_mail == []


def test_failed_email_retries_after_backoff(sockets, fake_mail, monkeypatch):
    client, auth, engine = ready(sockets)
    now = utc_now()
    monkeypatch.setattr(mail, "utc_now", lambda: now)
    def fail(*args):
        raise TimeoutError("provider credentials must not be stored in errors")
    monkeypatch.setattr(mail, "send_email", fail)
    assert advance(client, auth["counter"], "preparing", "ready").status_code == 200
    with Session(engine) as db:
        notice = db.scalar(select(Notification))
        assert notice.status == "pending"
        assert notice.last_error == "TimeoutError"
        assert notice.next_attempt_at == now + timedelta(minutes=1)
    assert mail.retry_due(engine) == 0
    monkeypatch.setattr(mail, "utc_now", lambda: now+timedelta(minutes=1))
    monkeypatch.setattr(mail, "send_email", lambda *args: fake_mail.append(args))
    assert mail.retry_due(engine) == 1
    assert len(fake_mail) == 1


def queue_without_delivery(sockets, monkeypatch):
    monkeypatch.setattr(mail, "email_settings", lambda: None)
    client, auth, engine = ready(sockets)
    assert advance(client, auth["counter"], "preparing", "ready").status_code == 200
    return client, auth, engine


def test_collected_order_drops_delayed_email(sockets, monkeypatch, fake_mail):
    client, auth, engine = queue_without_delivery(sockets, monkeypatch)
    assert advance(client, auth["counter"], "ready", "collected").status_code == 200
    monkeypatch.setattr(mail, "email_settings", lambda: SETTINGS)
    assert mail.retry_due(engine) == 0
    with Session(engine) as db:
        assert db.scalar(select(Notification)).status == "skipped"
    assert fake_mail == []


def test_worker_claim_is_exclusive_and_does_not_hold_sqlite(sockets, monkeypatch):
    _, _, engine = queue_without_delivery(sockets, monkeypatch)
    entered, release = Event(), Event()
    def slow_send(*args):
        entered.set()
        assert release.wait(5)
    monkeypatch.setattr(mail, "send_email", slow_send)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(mail.deliver, engine, 1, SETTINGS)
        try:
            assert entered.wait(5)
            assert mail.deliver(engine, 1, SETTINGS) is False
            with engine.begin() as conn:
                conn.exec_driver_sql("UPDATE menu_items SET price=13000 WHERE id=1")
        finally:
            release.set()
        assert first.result(timeout=5)


def test_expired_lease_recovers_after_process_exit(sockets, monkeypatch, fake_mail):
    _, _, engine = queue_without_delivery(sockets, monkeypatch)
    with Session(engine) as db:
        notice = db.get(Notification, 1)
        notice.status, notice.lease_token = "sending", "old-worker"
        notice.lease_until = utc_now()-timedelta(seconds=1)
        db.commit()
    assert mail.deliver(engine, 1, SETTINGS)
    assert len(fake_mail) == 1


def test_monthly_rollover_nepal_includes_old_dues_once(billing_client):
    _, engine = billing_client
    now = datetime(2026, 9, 30, 18, 20, tzinfo=timezone.utc)
    assert queue_monthly_dues(engine, now=now) == 2
    assert queue_monthly_dues(engine, now=now) == 0
    with Session(engine) as db:
        notices = db.scalars(select(Notification).order_by(Notification.student_id)).all()
        assert notices[0].event_key == "dues:2026-09:1"
        assert "NPR 240.00" in notices[0].body
        assert "NPR 120.00" in notices[1].body
        assert "2026-10-01 00:05 Nepal time" in notices[0].body


def test_monthly_excludes_settled_and_future_months(billing_client):
    client, engine = billing_client
    assert client.post("/admin/billing/settlements", json=SETTLEMENT).status_code == 201
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert queue_monthly_dues(engine, "2026-08", now) == 0
    assert queue_monthly_dues(engine, "2026-09", now) == 1
    with Session(engine) as db:
        assert db.scalar(select(Notification)).student_id == 2


@pytest.mark.parametrize("month", ["2026-13", "2026-9", "2026-10", "2027-01"])
def test_monthly_rejects_invalid_or_unfinished_month(billing_client, month):
    with pytest.raises(ValueError):
        queue_monthly_dues(billing_client[1], month, datetime(2026, 10, 1, tzinfo=timezone.utc))


def test_smtp_uses_tls_and_stable_message_id(monkeypatch):
    smtp = MagicMock()
    smtp.send_message.return_value = {}
    factory = MagicMock()
    factory.return_value.__enter__.return_value = smtp
    monkeypatch.setattr(mail.smtplib, "SMTP", factory)
    mail.send_email(SETTINGS, "student@example.test", "Token 8 is ready", "Collect token 8.", 42)
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("user", "secret")
    message = smtp.send_message.call_args.args[0]
    assert message["Message-ID"] == "<campusdine-42@example.test>"
    assert message["To"] == "student@example.test"
    assert [call[0] for call in smtp.method_calls] == ["ehlo", "starttls", "ehlo", "login", "send_message"]


def test_email_disabled_and_invalid_config(monkeypatch):
    monkeypatch.setenv("CAMPUSDINE_EMAIL_ENABLED", "false")
    assert mail.email_settings() is None
    monkeypatch.setenv("CAMPUSDINE_EMAIL_ENABLED", "true")
    monkeypatch.setenv("CAMPUSDINE_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("CAMPUSDINE_EMAIL_FROM", "canteen@example.test")
    monkeypatch.setenv("CAMPUSDINE_SMTP_SECURITY", "none")
    with pytest.raises(ValueError):
        mail.email_settings()
