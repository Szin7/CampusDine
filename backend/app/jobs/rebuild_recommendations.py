import logging

import numpy as np
import pandas as pd
from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.config import database_path
from app.db import make_engine
from app.models import Order, OrderItem, RecommendationBatch, RecommendationScore, Student, utc_now
from app.recommendations import USUALS_MIN_ORDERS


def calculate_scores(rows, eligible_students):
    if not rows:
        return []
    frame = pd.DataFrame(rows, columns=["order_id", "student_id", "menu_item_id"])
    frame["present"] = 1
    baskets = frame.pivot_table(index="order_id", columns="menu_item_id", values="present",
                                aggfunc="max", fill_value=0)
    matrix = baskets.to_numpy(dtype=np.int64)
    together = matrix.T @ matrix
    students = frame.drop_duplicates("order_id").set_index("order_id")["student_id"]
    owners = students.reindex(baskets.index).to_numpy()
    results = []
    # The full basket matrix is held in memory; monitor growth as order history accumulates.
    for student_id in eligible_students:
        own_mask = owners == student_id
        count = int(own_mask.sum())
        if not 0 < count < USUALS_MIN_ORDERS:
            continue
        own = matrix[own_mask]
        seeds = own.any(axis=0)
        # Subtract this student's baskets before normalizing, including the diagonal counts.
        others = together - own.T @ own
        occurrences = np.diag(others).astype(float)
        denominator = np.sqrt(np.outer(occurrences, occurrences))
        similarity = np.divide(others, denominator, out=np.zeros_like(denominator), where=denominator > 0)
        np.fill_diagonal(similarity, 0)
        scores = similarity[:, seeds].mean(axis=1)
        latest = int(baskets.index[own_mask].max())
        for item_id, score, already_tried in zip(baskets.columns, scores, seeds):
            if score > 0 and not already_tried:
                results.append(dict(student_id=int(student_id), menu_item_id=int(item_id),
                                    history_last_order_id=latest, score=min(float(score), 1.0)))
    return results


def rebuild(engine):
    with Session(engine) as db:
        watermark = db.scalar(select(func.max(Order.id))) or 0
        rows = db.execute(select(Order.id, Order.student_id, OrderItem.menu_item_id)
                          .join(OrderItem)).all()
        eligible = db.scalars(select(Student.id).where(Student.is_active.is_(True),
                              Student.approval_status == "approved")).all()
        started_at = utc_now()
    scores = calculate_scores(rows, eligible)
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        previous = db.get(RecommendationBatch, 1)
        if previous and (previous.source_max_order_id > watermark or previous.generated_at > started_at):
            return False
        db.execute(delete(RecommendationScore))
        if scores:
            db.execute(insert(RecommendationScore), scores)
        db.merge(RecommendationBatch(id=1, generated_at=started_at, source_max_order_id=watermark))
        db.commit()
    logging.info("Saved %s recommendation scores from orders through %s", len(scores), watermark)
    return True


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    engine = make_engine(database_path())
    try:
        rebuild(engine)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
