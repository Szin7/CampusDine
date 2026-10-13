import argparse
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import NEPAL_TZ, database_path
from app.db import make_engine
from app.models import CreditLedger, Notification, Student
from app.notifications import retry_due


def queue_monthly_dues(engine, month=None, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("Billing time must include a timezone")
    local = now.astimezone(NEPAL_TZ)
    current_month = local.strftime("%Y-%m")
    month = month or (local.date().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    if not re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", month) or month >= current_month:
        raise ValueError("Choose a completed calendar month in YYYY-MM format")
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        rows = db.execute(select(Student, func.sum(CreditLedger.amount)).join(CreditLedger)
                          .where(CreditLedger.status == "outstanding", CreditLedger.month <= month)
                          .group_by(Student.id)).all()
        keys = set(db.scalars(select(Notification.event_key)
                             .where(Notification.event_key.like(f"dues:{month}:%"))))
        count = 0
        for student, amount in rows:
            key = f"dues:{month}:{student.id}"
            if key in keys:
                continue
            db.add(Notification(event_key=key, student_id=student.id, kind="monthly_dues",
                                subject=f"CampusDine: outstanding canteen dues through {month}",
                                body=f"{student.name} ({student.roll_no}),\n\n"
                                     f"Your outstanding canteen credit through {month} is NPR {amount // 100:,}.{amount % 100:02d}.\n"
                                     f"This includes unpaid earlier months, as recorded on {local:%Y-%m-%d %H:%M} Nepal time.\n"
                                     "Please settle this with the National College of Engineering accounts office.\n"
                                     "Payments recorded after this statement will appear in your account balance.\n"))
            count += 1
        db.commit()
    return count


def main():
    parser = argparse.ArgumentParser(description="Queue the completed month's outstanding canteen dues")
    parser.add_argument("--month", help="YYYY-MM; defaults to the previous month in Nepal")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    engine = make_engine(database_path())
    try:
        logging.info("Queued %s monthly statements", queue_monthly_dues(engine, args.month))
        logging.info("Sent %s queued emails", retry_due(engine))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
