import asyncio
from dataclasses import dataclass, field
from datetime import datetime

from anyio import from_thread
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import LoginSession, Order, OrderStatusLog, Staff, Student, utc_now
from app.ordering import order_views


@dataclass(frozen=True)
class SocketIdentity:
    token_hash: str
    role: str
    account_id: int
    expires_at: datetime


def socket_identity(db: Session, token_hash: str) -> SocketIdentity | None:
    record = db.get(LoginSession, token_hash)
    if record is None or record.expires_at <= utc_now():
        return None
    if record.staff_id is not None:
        account, role = db.get(Staff, record.staff_id), "staff"
    elif record.student_id is not None:
        account, role = db.get(Student, record.student_id), "student"
    else:
        return None
    if account is None or not account.is_active or (role == "student" and account.approval_status != "approved"):
        return None
    return SocketIdentity(token_hash, role, account.id, record.expires_at)


def authenticate_socket(engine, token_hash: str):
    with Session(engine) as db:
        return socket_identity(db, token_hash)


def read_snapshot(engine, identity: SocketIdentity):
    with Session(engine) as db:
        if socket_identity(db, identity.token_hash) != identity:
            return None
        watermark = db.scalar(select(func.coalesce(func.max(OrderStatusLog.id), 0)))
        query = select(Order)
        if identity.role == "staff":
            query = query.where(Order.status != "collected")
        else:
            query = query.where(Order.student_id == identity.account_id)
            recent_collected = select(Order.id).where(Order.student_id == identity.account_id, Order.status == "collected").order_by(Order.id.desc()).limit(20).correlate(None)
            query = query.where((Order.status != "collected") | Order.id.in_(recent_collected))
        orders = db.scalars(query.order_by(Order.created_at, Order.id)).all()
        return {"type": "snapshot", "role": identity.role, "watermark": watermark,
                "orders": [view.model_dump(mode="json") for view in order_views(db, orders)]}


@dataclass(eq=False)
class Connection:
    identity: SocketIdentity
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=64))
    closed: asyncio.Event = field(default_factory=asyncio.Event)
    close_code: int = 1000
    watermark: int = 0
    revisions: dict[int, int] = field(default_factory=dict)

    def close(self, code: int):
        self.close_code = code
        self.closed.set()

    def enqueue(self, event: dict):
        if self.closed.is_set():
            return
        try:
            self.queue.put_nowait(event)
        except asyncio.QueueFull:
            self.close(1013)

    def accept_snapshot(self, snapshot: dict):
        self.watermark = snapshot["watermark"]
        self.revisions = {order["id"]: order["revision"] for order in snapshot["orders"]}

    def is_new(self, event: dict) -> bool:
        if event["type"] != "order.updated":
            return True
        order = event["order"]
        if order["revision"] <= max(self.watermark, self.revisions.get(order["id"], 0)):
            return False
        self.revisions[order["id"]] = order["revision"]
        return True


class OrderHub:
    def __init__(self):
        self.connections: set[Connection] = set()

    def register(self, identity: SocketIdentity) -> Connection | None:
        if sum(c.identity.token_hash == identity.token_hash and not c.closed.is_set() for c in self.connections) >= 5:
            return None
        connection = Connection(identity)
        self.connections.add(connection)
        return connection

    async def publish(self, order: dict):
        # Queue independently; never wait for one tablet's network inside the fan-out.
        event = {"type": "order.updated", "order": order}
        for connection in tuple(self.connections):
            if connection.identity.role == "staff" or connection.identity.account_id == order["student_id"]:
                connection.enqueue(event)

    async def revoke_session(self, token_hash: str):
        for connection in tuple(self.connections):
            if connection.identity.token_hash == token_hash:
                connection.close(4401)

    async def revoke_student(self, student_id: int):
        for connection in tuple(self.connections):
            if connection.identity.role == "student" and connection.identity.account_id == student_id:
                connection.close(4401)

    async def close_all(self):
        for connection in tuple(self.connections):
            connection.close(1012)


def publish_order(request, view):
    from_thread.run(request.app.state.order_hub.publish, view.model_dump(mode="json"))
