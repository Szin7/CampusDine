"""Disposable API database for browser tests; never opens the college database."""
import os
import sys
import tempfile
from pathlib import Path
from datetime import datetime

backend = Path(__file__).resolve().parents[2] / 'backend'
sys.path.insert(0, str(backend))
with tempfile.TemporaryDirectory(prefix='campusdine-browser-') as directory:
    os.environ['CAMPUSDINE_DB_PATH'] = str(Path(directory) / 'browser.sqlite3')
    os.environ['CAMPUSDINE_COOKIE_SECURE'] = 'false'
    os.environ['CAMPUSDINE_EMAIL_ENABLED'] = 'false'
    os.environ['CAMPUSDINE_STUDENT_FACE_LOGIN'] = 'true'
    os.environ['CAMPUSDINE_ALLOWED_ORIGINS'] = 'http://localhost:3000,http://127.0.0.1:3000'
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.orm import Session
    from app.auth import hash_password
    from app.db import make_engine
    from app.models import Admin, Staff, Student, MenuItem, WalletTransaction, CreditLedger, utc_now
    import uvicorn

    config = Config(str(backend / 'alembic.ini'))
    config.set_main_option('script_location', str(backend / 'migrations'))
    command.upgrade(config, 'head')
    engine = make_engine(Path(os.environ['CAMPUSDINE_DB_PATH']))
    with Session(engine) as db:
        password = hash_password('browser-test-password')
        admin = Admin(name='Accounts office', username='accounts', password_hash=password)
        db.add(admin)
        db.add(Admin(name="Reporting account", username="reports-admin", password_hash=password))
        db.flush()
        db.add(Staff(name='Counter staff', username='counter', password_hash=password))
        db.add(Staff(name='Queue staff', username='queue-staff', password_hash=password))
        for number in range(1, 5):
            db.add(Student(roll_no=f'TRACK-{number}', name=f'Tracker student {number}', department='Computer Engineering', semester=3,
                           email=f'track{number}@example.com', password_hash=password, approval_status='approved',
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                           wallet_balance=24000, credit_limit=24000))
        for number in range(1, 5):
            db.add(Student(roll_no=f'QUEUE-{number}', name=f'Queue student {number}', department='Computer Engineering', semester=3,
                           email=f'queue{number}@example.com', password_hash=password, approval_status='approved',
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                           wallet_balance=24000, credit_limit=24000))
        db.add(Student(roll_no='NCE-001', name='Sujin Prajapati', department='Computer Engineering', semester=3,
                       email='sujin@example.com', password_hash=password, approval_status='approved',
                       approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                       wallet_balance=45000, credit_limit=100000, credit_balance=12000))
        db.add(Student(roll_no='NCE-002', name='Pending student', department='Computer Engineering', semester=1,
                       email='pending@example.com', password_hash=password))
        for number, wallet, credit in [(1, 12000, 0), (2, 5000, 24000), (3, 12000, 0), (4, 12000, 0), (5, 12000, 0)]:
            db.add(Student(roll_no=f'COUNTER-{number}', name=f'Counter student {number}', department='Computer Engineering', semester=3,
                           email=f'counter{number}@example.com', password_hash=password, approval_status='approved',
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                           wallet_balance=wallet, credit_limit=credit))
        for number in range(1, 5):
            db.add(Student(roll_no=f'FUNDS-{number}', name=f'Accounts student {number}', department='Computer Engineering', semester=3,
                           email=f'funds{number}@example.com', password_hash=password, approval_status='approved',
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                           wallet_balance=10000, credit_limit=50000, credit_balance=12000))
        for number in range(1, 9):
            db.add(Student(roll_no=f'CHECK-{number}', name=f'Checkout student {number}', department='Computer Engineering', semester=3,
                           email=f'checkout{number}@example.com', password_hash=password, approval_status='approved',
                           approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                           wallet_balance=12000, credit_limit=24000, credit_balance=0))
        for name, price, category, available in [
            ('Veg momo', 12000, 'Momo', True), ('Chicken momo', 16000, 'Momo', True),
            ('Milk tea', 3000, 'Drinks', True), ('Black tea', 2000, 'Drinks', True),
            ('Veg chowmein', 10000, 'Noodles', True), ('Chicken chowmein', 14000, 'Noodles', False),
            ('Dal bhat', 15000, 'Lunch', True), ('Egg fried rice', 13000, 'Rice', True),
            ('Samosa', 2500, 'Snacks', True),
        ]:
            db.add(MenuItem(name=name, price=price, category=category, is_available=available))
        db.add(MenuItem(name='Old menu item', price=1000, category='Snacks', is_available=False, is_archived=True))
        wallet_student = Student(roll_no='WALLET-001', name='Anisha Shrestha', department='Computer Engineering', semester=5,
                                 email='wallet@example.com', password_hash=password, approval_status='approved',
                                 approved_by_admin_id=admin.id, approved_at=utc_now(), face_encoding=bytes(1024),
                                 wallet_balance=50000, credit_limit=100000)
        db.add(wallet_student)
        db.flush()
        for roll, state in [('REVIEW-001', 'pending'), ('REVIEW-002', 'pending'), ('MANAGE-001', 'approved'), ('MENU-001', 'approved')]:
            db.add(Student(roll_no=roll, name=f'Record {roll}', department='Civil Engineering', semester=3,
                           email=f'{roll.lower()}@example.com', password_hash=password, approval_status=state,
                           approved_by_admin_id=admin.id if state == 'approved' else None,
                           approved_at=utc_now() if state == 'approved' else None,
                           face_encoding=bytes(1024), wallet_balance=10000, credit_limit=20000))
        wallet_student_id = wallet_student.id
        admin_id = admin.id
        db.add(WalletTransaction(student_id=wallet_student_id, amount=50000, type='top_up', admin_id=admin_id,
                                 reference='Accounts receipt TOP-081', timestamp=datetime(2026, 9, 22, 18, 30)))
        db.commit()
    from app import ordering
    from app.schemas import CheckoutCreate
    clock = ordering.utc_now
    for day, key, quantity in [(23, 'wallet-fixture-paid', 1), (24, 'wallet-fixture-credit-1', 4), (25, 'wallet-fixture-credit-2', 4)]:
        ordering.utc_now = lambda day=day: datetime(2026, 9, day, 6)
        with Session(engine) as db:
            order, _ = ordering.place_order(db, wallet_student_id, CheckoutCreate(checkout_key=key,
                              expected_total=12000 * quantity, items=[{'menu_item_id': 1, 'quantity': quantity}]))
            db.commit()
    with Session(engine) as db:
        billing_ids = []
        for number in range(1, 5):
            student = Student(roll_no=f'BILL-{number}', name=f'Billing student {number}', department='Electronics, IT', semester=3,
                              email=f'bill{number}@example.com', password_hash=password, approval_status='approved',
                              approved_by_admin_id=admin_id, approved_at=utc_now(), face_encoding=bytes(1024), credit_limit=100000)
            db.add(student)
            db.flush()
            billing_ids.append(student.id)
        db.commit()
    for number, student_id in enumerate(billing_ids, 1):
        for month in (8, 9):
            ordering.utc_now = lambda month=month: datetime(2026, month, 20, 6)
            with Session(engine) as db:
                ordering.place_order(db, student_id, CheckoutCreate(checkout_key=f'billing-fixture-{number}-{month}',
                                     expected_total=12000, items=[{'menu_item_id': 1, 'quantity': 1}]))
                db.commit()
    with Session(engine) as db:
        db.get(Student, billing_ids[3]).is_active = False
        db.commit()
    ordering.utc_now = clock
    from sqlalchemy import select
    with Session(engine) as db:
        entry = db.scalar(select(CreditLedger).where(CreditLedger.student_id == wallet_student_id).order_by(CreditLedger.id))
        entry.status = 'settled'
        entry.settled_at = datetime(2026, 9, 26, 18, 30)
        entry.settled_by_admin_id = admin_id
        entry.settlement_reference = 'Accounts transfer SET-081'
        db.get(Student, wallet_student_id).credit_balance -= entry.amount
        db.commit()
    engine.dispose()
    uvicorn.run('app.main:app', host='127.0.0.1', port=8000)
