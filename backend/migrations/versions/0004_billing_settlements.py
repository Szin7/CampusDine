"""billing_settlements"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('billing_settlements',
    sa.Column('request_key', sa.String(length=64), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('admin_id', sa.Integer(), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('ledger_ids', sa.JSON(), nullable=False),
    sa.Column('reference', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("typeof(amount) = 'integer' AND amount > 0", name='ck_settlement_amount'),
    sa.ForeignKeyConstraint(['admin_id'], ['admins.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('request_key')
    )
    with op.batch_alter_table('billing_settlements', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_billing_settlements_student_id'), ['student_id'], unique=False)



def downgrade():
    with op.batch_alter_table('billing_settlements', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_billing_settlements_student_id'))

    op.drop_table('billing_settlements')
