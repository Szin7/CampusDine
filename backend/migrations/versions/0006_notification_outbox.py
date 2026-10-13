"""notification_outbox"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('notifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('event_key', sa.String(length=100), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=True),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('subject', sa.String(length=160), nullable=False),
    sa.Column('body', sa.String(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(), nullable=False),
    sa.Column('lease_token', sa.String(length=32), nullable=True),
    sa.Column('lease_until', sa.DateTime(), nullable=True),
    sa.Column('sent_at', sa.DateTime(), nullable=True),
    sa.Column('last_error', sa.String(length=100), nullable=True),
    sa.CheckConstraint("kind IN ('order_ready', 'monthly_dues')", name='ck_notification_kind'),
    sa.CheckConstraint("status IN ('pending', 'sending', 'sent', 'skipped')", name='ck_notification_status'),
    sa.CheckConstraint('attempts >= 0', name='ck_notification_attempts'),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('event_key')
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index('ix_notification_due', ['status', 'next_attempt_at'], unique=False)



def downgrade():
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index('ix_notification_due')

    op.drop_table('notifications')
