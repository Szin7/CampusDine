import os
import math

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import database_path
from app.db import make_engine
from app.auth import AuthThrottle
from app.realtime import OrderHub
from app.routes import auth, students, admin_students, counter, menu, admin_menu, orders, wallet, admin_accounts, billing, reports, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    tolerance = float(os.getenv("CAMPUSDINE_FACE_TOLERANCE", "0.5"))
    if not math.isfinite(tolerance) or not 0 < tolerance <= 0.6:
        raise ValueError("CAMPUSDINE_FACE_TOLERANCE must be greater than 0 and at most 0.6")
    app.state.face_tolerance = tolerance
    app.state.student_face_login = os.getenv("CAMPUSDINE_STUDENT_FACE_LOGIN", "false").lower() == "true"
    app.state.db_engine = make_engine(database_path())
    app.state.auth_throttle = AuthThrottle()
    app.state.order_hub = OrderHub()
    app.state.allowed_origins = {origin.strip() for origin in os.getenv(
        "CAMPUSDINE_ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000"
    ).split(",") if origin.strip()}
    app.state.cookie_secure = os.getenv("CAMPUSDINE_COOKIE_SECURE", "true").lower() == "true"
    try:
        yield
    finally:
        await app.state.order_hub.close_all()
        app.state.db_engine.dispose()


app = FastAPI(title="CampusDine", version="0.1.0", lifespan=lifespan)


app.include_router(auth.router)
app.include_router(students.router)
app.include_router(admin_students.router)
app.include_router(counter.router)
app.include_router(menu.router)
app.include_router(admin_menu.router)
app.include_router(orders.router)
app.include_router(wallet.router)
app.include_router(admin_accounts.router)
app.include_router(billing.router)
app.include_router(reports.router)
app.include_router(websocket.router)


@app.middleware("http")
async def private_responses(request, call_next):
    response = await call_next(request)
    # API responses can contain account or financial data, including errors.
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/health")
def health():
    return {"status": "ok", "app": "CampusDine"}


@app.exception_handler(OperationalError)
async def database_busy(request, exc):
    code = getattr(exc.orig, "sqlite_errorcode", 0)
    if code & 255 in {5, 6}:
        return JSONResponse(status_code=503, content={"detail": "The database is busy. Retry the same request without changing its request key."},
                            headers={"Retry-After": "1"})
    raise exc
