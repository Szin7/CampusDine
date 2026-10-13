import asyncio
from datetime import timedelta
from threading import Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.auth import hash_password
from app.main import app
from app.models import Admin, LoginSession, MenuItem, Staff, Student, utc_now
from app.realtime import Connection, OrderHub, SocketIdentity
from app.routes import websocket as socket_routes

PASSWORD = "socket-test-password"
ORIGIN = {"Origin": "http://localhost:8000"}


@pytest.fixture
def sockets(migrated_db, monkeypatch):
    engine, _ = migrated_db
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    hashed = hash_password(PASSWORD)
    with Session(engine) as db:
        admin = Admin(name="Accounts", username="accounts", password_hash=hashed)
        db.add(admin)
        db.flush()
        db.add(Staff(name="Counter", username="counter", password_hash=hashed))
        for i in (1, 2):
            db.add(Student(roll_no=f"NCE-00{i}", name=f"Student {i}", department="Computer", semester=3,
                           email=f"s{i}@example.com", password_hash=hashed, approval_status="approved",
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024), wallet_balance=100000))
        db.add(MenuItem(name="Veg momo", price=12000, category="Momo"))
        db.commit()
    with TestClient(app) as client:
        credentials = {}
        for role, name in (("staff", "counter"), ("student", "NCE-001"), ("student", "NCE-002"), ("admin", "accounts")):
            response = client.post("/auth/login", json={"role": role, "username": name, "password": PASSWORD}, headers={"Cookie": ""})
            credentials[name] = {"Cookie": f"campusdine_session={client.cookies.get('campusdine_session')}",
                                 "X-CSRF-Token": response.json()["csrf_token"]}
        yield client, credentials, engine


def connect(client, credentials):
    return client.websocket_connect("/ws/orders", headers=ORIGIN | credentials)


def place(client, credentials, key="socket-order-0001"):
    return client.post("/orders", headers=credentials, json={"checkout_key": key, "expected_total": 12000,
                       "items": [{"menu_item_id": 1, "quantity": 1}]})


def advance(client, credentials, source, target):
    return client.patch("/staff/orders/1/status", headers=credentials, json={"expected_status": source, "status": target})


def test_broadcast_fanout_privacy_and_duplicate_retry(sockets):
    client, auth, engine = sockets
    with connect(client, auth["counter"]) as staff1, connect(client, auth["counter"]) as staff2, \
         connect(client, auth["NCE-001"]) as student, connect(client, auth["NCE-002"]) as other:
        for socket in (staff1, staff2, student, other):
            assert socket.receive_json()["orders"] == []
        placed = place(client, auth["NCE-001"])
        assert placed.status_code == 201
        for socket in (staff1, staff2, student):
            event = socket.receive_json()
            assert event["type"] == "order.updated" and event["order"] == placed.json()
        other.send_text("ping")
        assert other.receive_json() == {"type": "pong"}
        assert place(client, auth["NCE-001"]).status_code == 200
        student.send_text("ping")
        assert student.receive_json() == {"type": "pong"}
        for source, target in (("received", "preparing"), ("preparing", "ready"), ("ready", "collected")):
            response = advance(client, auth["counter"], source, target)
            assert response.status_code == 200
            for socket in (staff1, staff2, student):
                assert socket.receive_json()["order"] == response.json()
        assert advance(client, auth["counter"], "ready", "collected").status_code == 200
        student.send_text("ping")
        assert student.receive_json() == {"type": "pong"}
    with connect(client, auth["counter"]) as staff, connect(client, auth["NCE-001"]) as student:
        assert staff.receive_json()["orders"] == []
        assert student.receive_json()["orders"][0]["status"] == "collected"


def test_handshake_rejects_missing_session_bad_origin_and_admin(sockets):
    client, auth, _ = sockets
    for headers, code in ((ORIGIN | {"Cookie": ""}, 4401),
                          (auth["counter"] | {"Origin": "https://elsewhere.example"}, 4403),
                          (auth["counter"] | {"Origin": ""}, 4403), (ORIGIN | auth["accounts"], 4401)):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws/orders", headers=headers):
                pass
        assert exc.value.code == code


def test_failed_commit_does_not_publish(sockets):
    client, auth, engine = sockets
    with connect(client, auth["counter"]) as staff:
        staff.receive_json()
        with engine.begin() as conn:
            conn.exec_driver_sql("""CREATE TRIGGER fail_order BEFORE INSERT ON wallet_transactions
                                   BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
        with pytest.raises(IntegrityError):
            place(client, auth["NCE-001"])
        staff.send_text("ping")
        assert staff.receive_json() == {"type": "pong"}


def test_logout_closes_socket(sockets):
    client, auth, _ = sockets
    with connect(client, auth["NCE-001"]) as student:
        student.receive_json()
        assert client.post("/auth/logout", headers=auth["NCE-001"]).status_code == 204
        with pytest.raises(WebSocketDisconnect) as exc:
            student.receive_json()
        assert exc.value.code == 4401


def test_suspension_closes_socket(sockets):
    client, auth, _ = sockets
    with connect(client, auth["NCE-001"]) as student:
        student.receive_json()
        assert client.patch("/admin/students/1", headers=auth["accounts"], json={"is_active": False}).status_code == 200
        with pytest.raises(WebSocketDisconnect) as exc:
            student.receive_json()
        assert exc.value.code == 4401


def test_session_expiry_closes_socket(sockets):
    client, auth, engine = sockets
    with Session(engine) as db:
        record = db.scalar(select(LoginSession).where(LoginSession.student_id == 1))
        record.expires_at = utc_now() + timedelta(seconds=0.5)
        db.commit()
    with connect(client, auth["NCE-001"]) as student:
        student.receive_json()
        with pytest.raises(WebSocketDisconnect) as exc:
            student.receive_json()
        assert exc.value.code == 4401


def test_snapshot_registration_has_no_update_gap(sockets, monkeypatch):
    client, auth, _ = sockets
    original = socket_routes.read_snapshot
    snapshot_read, release = Event(), Event()
    def paused_snapshot(engine, identity):
        snapshot = original(engine, identity)
        snapshot_read.set()
        assert release.wait(timeout=5)
        return snapshot
    monkeypatch.setattr(socket_routes, "read_snapshot", paused_snapshot)
    with connect(client, auth["counter"]) as staff:
        assert snapshot_read.wait(timeout=5)
        response = place(client, auth["NCE-001"])
        release.set()
        assert staff.receive_json()["orders"] == []
        assert staff.receive_json()["order"]["id"] == response.json()["id"]


def test_slow_subscriber_does_not_block_healthy_one():
    async def exercise():
        hub = OrderHub()
        identity = SocketIdentity("test", "staff", 1, utc_now() + timedelta(hours=1))
        slow, healthy = hub.register(identity), hub.register(identity)
        slow.queue = asyncio.Queue(maxsize=1)
        await hub.publish({"id": 1, "student_id": 1, "revision": 1})
        healthy.queue.get_nowait()
        await hub.publish({"id": 1, "student_id": 1, "revision": 2})
        assert slow.closed.is_set() and slow.close_code == 1013
        assert not healthy.closed.is_set()
        assert healthy.queue.get_nowait()["order"]["revision"] == 2
    asyncio.run(exercise())


def test_snapshot_watermark_and_per_order_revisions():
    connection = Connection(SocketIdentity("test", "staff", 1, utc_now()))
    connection.accept_snapshot({"watermark": 10, "orders": []})
    def event(order_id, revision):
        return {"type": "order.updated", "order": {"id": order_id, "revision": revision}}
    assert not connection.is_new(event(1, 9))
    assert connection.is_new(event(1, 12))
    assert not connection.is_new(event(1, 11))
    assert connection.is_new(event(2, 11))
    assert not connection.is_new(event(1, 12))


def test_socket_rejects_commands_and_binary_frames(sockets):
    client, auth, _ = sockets
    for binary in (False, True):
        with connect(client, auth["counter"]) as staff:
            staff.receive_json()
            if binary:
                staff.send_bytes(b'change status')
            else:
                staff.send_text('{"status":"ready"}')
            with pytest.raises(WebSocketDisconnect) as exc:
                staff.receive_json()
            assert exc.value.code == 1008
