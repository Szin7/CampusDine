from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.jobs import rebuild_recommendations as job
from app.main import app
from app.models import MenuItem, Order, OrderItem, RecommendationBatch, RecommendationScore
from app.recommendations import recommend
from test_ordering import shop, PASSWORD

NOW = datetime(2026, 9, 27, 6, tzinfo=timezone.utc)


def add_order(db, student_id, items, day=date(2026, 9, 27), hour=6, quantity=1):
    token = (db.scalar(select(func.max(Order.token_number)).where(Order.order_date == day)) or 0) + 1
    order = Order(student_id=student_id, token_number=token, order_date=day,
                  total_amount=12000 * len(items) * quantity, payment_type="wallet",
                  checkout_key=f"fixture-{day}-{token}", request_fingerprint="a" * 64,
                  created_at=datetime.combine(day, datetime.min.time()).replace(hour=hour))
    db.add(order)
    db.flush()
    for item_id in items:
        db.add(OrderItem(order_id=order.id, menu_item_id=item_id, item_name="Fixture item",
                         unit_price=12000, quantity=quantity))
    db.flush()
    return order.id


@pytest.fixture
def baskets(shop):
    with Session(shop) as db:
        db.add_all([MenuItem(name="Milk tea", price=3000, category="Drinks"),
                    MenuItem(name="Veg chowmein", price=10000, category="Noodles")])
        db.flush()
        for items in ([1, 2], [1, 2], [1, 3], [2, 3], [3]):
            add_order(db, 2, items)
        add_order(db, 1, [1], quantity=7)
        db.commit()
    return shop


def results(engine, student_id=1, now=NOW, limit=3):
    with Session(engine) as db:
        return [(x["item"].id, x["source"]) for x in recommend(db, student_id, limit, now)["items"]]


def test_leave_one_out_cosine_matches_interview_example(baskets, monkeypatch):
    monkeypatch.setattr(job, "utc_now", lambda: NOW.replace(tzinfo=None))
    assert job.rebuild(baskets)
    with Session(baskets) as db:
        scores = db.scalars(select(RecommendationScore).where(RecommendationScore.student_id == 1)
                           .order_by(RecommendationScore.menu_item_id)).all()
        assert [r.menu_item_id for r in scores] == [2, 3]
        assert [r.score for r in scores] == pytest.approx([2/3, 1/3])
    assert results(baskets) == [(2, "collaborative"), (3, "collaborative"), (1, "popular")]
    assert job.rebuild(baskets)
    with Session(baskets) as db:
        assert db.scalar(select(func.count()).select_from(RecommendationScore)) == 2


def test_usuals_frequency_then_recency_not_quantity(shop):
    with Session(shop) as db:
        db.add(MenuItem(name="Milk tea", price=3000, category="Drinks"))
        db.flush()
        add_order(db, 1, [1], hour=1, quantity=20)
        add_order(db, 1, [2], hour=2)
        add_order(db, 1, [1, 2], hour=3)
        add_order(db, 1, [2], hour=4)
        db.commit()
    assert results(shop) == [(2, "usual"), (1, "usual")]
    with Session(shop) as db:
        add_order(db, 1, [1], hour=5)
        db.commit()
    assert results(shop) == [(1, "usual"), (2, "usual")]


def test_stale_or_changed_history_falls_back(baskets, monkeypatch):
    monkeypatch.setattr(job, "utc_now", lambda: NOW.replace(tzinfo=None))
    job.rebuild(baskets)
    assert all(source != "collaborative" for _, source in results(baskets, now=NOW+timedelta(hours=49)))
    with Session(baskets) as db:
        add_order(db, 1, [2])
        db.commit()
    assert all(source != "collaborative" for _, source in results(baskets))


def test_current_availability_overrides_batch(baskets, monkeypatch):
    monkeypatch.setattr(job, "utc_now", lambda: NOW.replace(tzinfo=None))
    job.rebuild(baskets)
    with Session(baskets) as db:
        db.get(MenuItem, 2).is_available = False
        db.get(MenuItem, 3).is_archived = True
        db.commit()
    assert results(baskets) == [(1, "popular")]


def test_empty_history_week_boundary_and_catalog_fallback(shop):
    with Session(shop) as db:
        db.add(MenuItem(name="Milk tea", price=3000, category="Drinks"))
        db.flush()
        add_order(db, 2, [1], day=date(2026, 9, 20), quantity=10)
        add_order(db, 2, [2], day=date(2026, 9, 21))
        db.commit()
    assert results(shop) == [(2, "popular"), (1, "menu")]
    # Sunday UTC has already crossed into Monday in Kathmandu.
    assert results(shop, now=datetime(2026, 9, 27, 19, tzinfo=timezone.utc)) == [(2, "menu"), (1, "menu")]


def test_no_other_students_and_multiple_seeds():
    assert job.calculate_scores([(1, 1, 1), (1, 1, 2)], [1]) == []
    rows = [(1, 1, 1), (1, 1, 2), (2, 2, 1), (2, 2, 3), (3, 2, 2)]
    scores = job.calculate_scores(rows, [1])
    assert len(scores) == 1
    assert scores[0]["score"] == pytest.approx(.5)
    assert job.calculate_scores([], [1]) == []


def test_failed_publish_preserves_previous_batch(baskets, monkeypatch):
    monkeypatch.setattr(job, "utc_now", lambda: NOW.replace(tzinfo=None))
    job.rebuild(baskets)
    before = results(baskets)
    monkeypatch.setattr(job, "calculate_scores", lambda *args: [dict(student_id=1, menu_item_id=999,
                         history_last_order_id=6, score=.5)])
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        job.rebuild(baskets)
    assert results(baskets) == before


def test_older_batch_cannot_replace_newer_one(baskets, monkeypatch):
    monkeypatch.setattr(job, "utc_now", lambda: NOW.replace(tzinfo=None))
    job.rebuild(baskets)
    monkeypatch.setattr(job, "utc_now", lambda: (NOW-timedelta(hours=1)).replace(tzinfo=None))
    assert job.rebuild(baskets) is False


def test_route_student_only_and_no_store(baskets, monkeypatch):
    monkeypatch.setenv("CAMPUSDINE_COOKIE_SECURE", "false")
    with TestClient(app) as client:
        assert client.get("/menu/recommendations").status_code == 401
        client.post("/auth/login", json={"role": "student", "username": "NCE-001", "password": PASSWORD})
        response = client.get("/menu/recommendations?limit=2")
        assert response.status_code == 200
        assert len(response.json()["items"]) == 2
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/menu/recommendations?limit=0").status_code == 422
        client.cookies.clear()
        client.post("/auth/login", json={"role": "staff", "username": "counter", "password": PASSWORD})
        assert client.get("/menu/recommendations").status_code == 403
