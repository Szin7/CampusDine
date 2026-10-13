"""account_audit"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('credit_limit_changes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('admin_id', sa.Integer(), nullable=False),
    sa.Column('old_limit', sa.Integer(), nullable=False),
    sa.Column('new_limit', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=120), nullable=False),
    sa.Column('changed_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("typeof(new_limit) = 'integer' AND new_limit >= 0", name='ck_new_credit_limit'),
    sa.CheckConstraint("typeof(old_limit) = 'integer' AND old_limit >= 0", name='ck_old_credit_limit'),
    sa.ForeignKeyConstraint(['admin_id'], ['admins.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('credit_limit_changes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_credit_limit_changes_student_id'), ['student_id'], unique=False)

    with op.batch_alter_table('wallet_transactions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('request_key', sa.String(length=64), nullable=True))
        batch_op.create_unique_constraint('uq_wallet_request_key', ['request_key'])



def downgrade():
    with op.batch_alter_table('wallet_transactions', schema=None) as batch_op:
        batch_op.drop_constraint('uq_wallet_request_key', type_='unique')
        batch_op.drop_column('request_key')

    with op.batch_alter_table('credit_limit_changes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_credit_limit_changes_student_id'))

    op.drop_table('credit_limit_changes')
