from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import NEPAL_TZ
from app.models import MenuItem, Order, OrderItem, RecommendationBatch, RecommendationScore
from app.schemas import MenuView

USUALS_MIN_ORDERS = 3
CACHE_MAX_AGE = timedelta(hours=48)


def recommend(db: Session, student_id: int, limit: int, now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("Recommendation time must include a timezone")
    available = (MenuItem.is_available.is_(True), MenuItem.is_archived.is_(False))
    count, latest = db.execute(select(func.count(Order.id), func.max(Order.id))
                               .where(Order.student_id == student_id)).one()
    chosen = []
    seen = set()

    def append(items, source):
        for item in items:
            if item.id not in seen and len(chosen) < limit:
                chosen.append({"item": MenuView.model_validate(item), "source": source})
                seen.add(item.id)

    if count >= USUALS_MIN_ORDERS:
        usuals = (select(MenuItem).join(OrderItem).join(Order)
                  .where(Order.student_id == student_id, *available)
                  .group_by(MenuItem.id)
                  .order_by(func.count(Order.id).desc(), func.max(Order.created_at).desc(), MenuItem.id)
                  .limit(limit))
        append(db.scalars(usuals), "usual")
    elif count:
        batch = db.get(RecommendationBatch, 1)
        age = now.astimezone(timezone.utc).replace(tzinfo=None) - batch.generated_at if batch else None
        if age is not None and timedelta(0) <= age <= CACHE_MAX_AGE:
            cached = (select(MenuItem).join(RecommendationScore)
                      .where(RecommendationScore.student_id == student_id,
                             RecommendationScore.history_last_order_id == latest, *available)
                      .order_by(RecommendationScore.score.desc(), MenuItem.id).limit(limit))
            append(db.scalars(cached), "collaborative")

    today = now.astimezone(NEPAL_TZ).date()
    monday = today - timedelta(days=today.weekday())
    popular = (select(MenuItem).join(OrderItem).join(Order)
               .where(Order.order_date.between(monday, today), *available)
               .group_by(MenuItem.id).order_by(func.count(Order.id).desc(), MenuItem.id)
               .limit(limit))
    append(db.scalars(popular), "popular")
    if len(chosen) < limit:
        append(db.scalars(select(MenuItem).where(*available)
                          .order_by(MenuItem.category, MenuItem.id).limit(limit)), "menu")
    return {"items": chosen}
