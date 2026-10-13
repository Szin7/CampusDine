"""initial_schema"""
from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('admins',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('username', sa.String(length=80, collation='NOCASE'), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('is_active', sa.Boolean(create_constraint=True), server_default='1', nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username')
    )
    op.create_table('daily_token_counters',
    sa.Column('order_date', sa.Date(), nullable=False),
    sa.Column('last_token', sa.Integer(), server_default='0', nullable=False),
    sa.CheckConstraint("typeof(last_token) = 'integer' AND last_token >= 0", name='ck_last_token'),
    sa.PrimaryKeyConstraint('order_date')
    )
    op.create_table('menu_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('price', sa.Integer(), nullable=False),
    sa.Column('category', sa.String(length=50), nullable=False),
    sa.Column('is_available', sa.Boolean(create_constraint=True), server_default='1', nullable=False),
    sa.Column('is_archived', sa.Boolean(create_constraint=True), server_default='0', nullable=False),
    sa.CheckConstraint("typeof(price) = 'integer' AND price > 0", name='ck_menu_price'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('staff',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('username', sa.String(length=80, collation='NOCASE'), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('is_active', sa.Boolean(create_constraint=True), server_default='1', nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username')
    )
    op.create_table('students',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('roll_no', sa.String(length=40, collation='NOCASE'), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('department', sa.String(length=100), nullable=False),
    sa.Column('semester', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254, collation='NOCASE'), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('face_encoding', sa.LargeBinary(), nullable=True),
    sa.Column('wallet_balance', sa.Integer(), server_default='0', nullable=False),
    sa.Column('credit_limit', sa.Integer(), server_default='0', nullable=False),
    sa.Column('credit_balance', sa.Integer(), server_default='0', nullable=False),
    sa.Column('approval_status', sa.String(length=16), server_default='pending', nullable=False),
    sa.Column('is_active', sa.Boolean(create_constraint=True), server_default='1', nullable=False),
    sa.Column('approved_by_admin_id', sa.Integer(), nullable=True),
    sa.Column('approved_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("approval_status != 'approved' OR (approved_by_admin_id IS NOT NULL AND approved_at IS NOT NULL AND face_encoding IS NOT NULL)", name='ck_student_approved_fields'),
    sa.CheckConstraint("approval_status IN ('pending', 'approved', 'rejected')", name='ck_student_approval'),
    sa.CheckConstraint("typeof(credit_balance) = 'integer' AND credit_balance >= 0 AND credit_balance <= credit_limit", name='ck_student_credit_balance'),
    sa.CheckConstraint("typeof(credit_limit) = 'integer' AND credit_limit >= 0", name='ck_student_credit_limit'),
    sa.CheckConstraint("typeof(wallet_balance) = 'integer' AND wallet_balance >= 0", name='ck_student_wallet'),
    sa.CheckConstraint('face_encoding IS NULL OR length(face_encoding) = 1024', name='ck_face_encoding_length'),
    sa.CheckConstraint('semester BETWEEN 1 AND 8', name='ck_student_semester'),
    sa.ForeignKeyConstraint(['approved_by_admin_id'], ['admins.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    sa.UniqueConstraint('roll_no')
    )
    op.create_table('orders',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('token_number', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='received', nullable=False),
    sa.Column('order_date', sa.Date(), nullable=False),
    sa.Column('total_amount', sa.Integer(), nullable=False),
    sa.Column('payment_type', sa.String(length=10), nullable=False),
    sa.Column('checkout_key', sa.String(length=64), nullable=False),
    sa.Column('request_fingerprint', sa.String(length=64), nullable=False),
    sa.Column('placed_by_staff_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("payment_type IN ('wallet', 'credit')", name='ck_order_payment'),
    sa.CheckConstraint("status IN ('received', 'preparing', 'ready', 'collected')", name='ck_order_status'),
    sa.CheckConstraint("typeof(token_number) = 'integer' AND token_number > 0", name='ck_order_token'),
    sa.CheckConstraint("typeof(total_amount) = 'integer' AND total_amount > 0", name='ck_order_total'),
    sa.ForeignKeyConstraint(['placed_by_staff_id'], ['staff.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_date', 'token_number', name='uq_order_daily_token'),
    sa.UniqueConstraint('student_id', 'checkout_key', name='uq_order_checkout')
    )
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.create_index('ix_orders_queue', ['order_date', 'status'], unique=False)
        batch_op.create_index('ix_orders_student_created', ['student_id', 'created_at'], unique=False)

    op.create_table('credit_ledger',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='outstanding', nullable=False),
    sa.Column('month', sa.String(length=7), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('settled_at', sa.DateTime(), nullable=True),
    sa.Column('settled_by_admin_id', sa.Integer(), nullable=True),
    sa.Column('settlement_reference', sa.String(length=120), nullable=True),
    sa.CheckConstraint("(status = 'outstanding' AND settled_at IS NULL AND settled_by_admin_id IS NULL AND settlement_reference IS NULL) OR (status = 'settled' AND settled_at IS NOT NULL AND settled_by_admin_id IS NOT NULL AND settlement_reference IS NOT NULL)", name='ck_credit_settlement'),
    sa.CheckConstraint("month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(month, 6, 2) BETWEEN '01' AND '12'", name='ck_credit_month'),
    sa.CheckConstraint("status IN ('outstanding', 'settled')", name='ck_credit_status'),
    sa.CheckConstraint("typeof(amount) = 'integer' AND amount > 0", name='ck_credit_amount'),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['settled_by_admin_id'], ['admins.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id')
    )
    with op.batch_alter_table('credit_ledger', schema=None) as batch_op:
        batch_op.create_index('ix_credit_outstanding', ['status', 'month', 'student_id'], unique=False)

    op.create_table('order_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('menu_item_id', sa.Integer(), nullable=False),
    sa.Column('item_name', sa.String(length=120), nullable=False),
    sa.Column('unit_price', sa.Integer(), nullable=False),
    sa.Column('quantity', sa.Integer(), nullable=False),
    sa.CheckConstraint("typeof(quantity) = 'integer' AND quantity > 0", name='ck_item_quantity'),
    sa.CheckConstraint("typeof(unit_price) = 'integer' AND unit_price > 0", name='ck_item_price'),
    sa.ForeignKeyConstraint(['menu_item_id'], ['menu_items.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id', 'menu_item_id', name='uq_order_item')
    )
    with op.batch_alter_table('order_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_order_items_order_id'), ['order_id'], unique=False)

    op.create_table('order_status_log',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('changed_at', sa.DateTime(), nullable=False),
    sa.Column('changed_by_staff_id', sa.Integer(), nullable=True),
    sa.CheckConstraint("status = 'received' OR changed_by_staff_id IS NOT NULL", name='ck_log_staff_actor'),
    sa.CheckConstraint("status IN ('received', 'preparing', 'ready', 'collected')", name='ck_log_status'),
    sa.ForeignKeyConstraint(['changed_by_staff_id'], ['staff.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('order_status_log', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_order_status_log_order_id'), ['order_id'], unique=False)

    op.create_table('wallet_transactions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=True),
    sa.Column('admin_id', sa.Integer(), nullable=True),
    sa.Column('reference', sa.String(length=120), nullable=True),
    sa.Column('timestamp', sa.DateTime(), nullable=False),
    sa.CheckConstraint("(type = 'top_up' AND amount > 0 AND admin_id IS NOT NULL AND order_id IS NULL) OR (type = 'order_debit' AND amount < 0 AND order_id IS NOT NULL AND admin_id IS NULL)", name='ck_wallet_transaction_kind'),
    sa.CheckConstraint("typeof(amount) = 'integer'", name='ck_wallet_integer'),
    sa.ForeignKeyConstraint(['admin_id'], ['admins.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('order_id')
    )
    with op.batch_alter_table('wallet_transactions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_wallet_transactions_student_id'), ['student_id'], unique=False)



def downgrade():
    with op.batch_alter_table('wallet_transactions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_wallet_transactions_student_id'))

    op.drop_table('wallet_transactions')
    with op.batch_alter_table('order_status_log', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_order_status_log_order_id'))

    op.drop_table('order_status_log')
    with op.batch_alter_table('order_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_order_items_order_id'))

    op.drop_table('order_items')
    with op.batch_alter_table('credit_ledger', schema=None) as batch_op:
        batch_op.drop_index('ix_credit_outstanding')

    op.drop_table('credit_ledger')
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.drop_index('ix_orders_student_created')
        batch_op.drop_index('ix_orders_queue')

    op.drop_table('orders')
    op.drop_table('students')
    op.drop_table('staff')
    op.drop_table('menu_items')
    op.drop_table('daily_token_counters')
    op.drop_table('admins')
