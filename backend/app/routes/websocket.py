import asyncio

from anyio import to_thread
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth import COOKIE_NAME, token_digest
from app.models import utc_now
from app.realtime import authenticate_socket, read_snapshot

router = APIRouter()
SEND_TIMEOUT = 5


async def send_updates(websocket, connection):
    while not connection.closed.is_set():
        event = await connection.queue.get()
        if connection.is_new(event):
            await asyncio.wait_for(websocket.send_json(event), timeout=SEND_TIMEOUT)


async def receive_messages(websocket, connection):
    while not connection.closed.is_set():
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        if message.get("text") != "ping":
            connection.close(1008)
            return
        connection.enqueue({"type": "pong"})


async def expire_session(connection):
    await asyncio.sleep(max(0, (connection.identity.expires_at - utc_now()).total_seconds()))
    connection.close(4401)


@router.websocket("/ws/orders")
async def order_socket(websocket: WebSocket):
    if websocket.headers.get("origin") not in websocket.app.state.allowed_origins:
        await websocket.close(code=4403)
        return
    token = websocket.cookies.get(COOKIE_NAME)
    identity = await to_thread.run_sync(authenticate_socket, websocket.app.state.db_engine, token_digest(token)) if token else None
    if identity is None:
        await websocket.close(code=4401)
        return
    hub = websocket.app.state.order_hub
    connection = hub.register(identity)
    if connection is None:
        await websocket.close(code=4429)
        return
    tasks = []
    try:
        await websocket.accept()
        # Subscribe first, then read one consistent snapshot. The watermark discards overlap.
        snapshot = await to_thread.run_sync(read_snapshot, websocket.app.state.db_engine, identity)
        if snapshot is None or connection.closed.is_set() or identity.expires_at <= utc_now():
            connection.close(4401)
            return
        connection.accept_snapshot(snapshot)
        await asyncio.wait_for(websocket.send_json(snapshot), timeout=SEND_TIMEOUT)
        tasks = [asyncio.create_task(send_updates(websocket, connection)),
                 asyncio.create_task(receive_messages(websocket, connection)),
                 asyncio.create_task(expire_session(connection)),
                 asyncio.create_task(connection.closed.wait())]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    except (TimeoutError, OSError):
        connection.close(1013)
    finally:
        hub.connections.discard(connection)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await websocket.close(code=connection.close_code)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
