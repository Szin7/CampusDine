"""login_sessions"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('login_sessions',
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('csrf_token', sa.String(length=64), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=True),
    sa.Column('staff_id', sa.Integer(), nullable=True),
    sa.Column('admin_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('(student_id IS NOT NULL) + (staff_id IS NOT NULL) + (admin_id IS NOT NULL) = 1', name='ck_session_one_account'),
    sa.ForeignKeyConstraint(['admin_id'], ['admins.id'], ),
    sa.ForeignKeyConstraint(['staff_id'], ['staff.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('token_hash')
    )
    with op.batch_alter_table('login_sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_login_sessions_admin_id'), ['admin_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_login_sessions_expires_at'), ['expires_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_login_sessions_staff_id'), ['staff_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_login_sessions_student_id'), ['student_id'], unique=False)



def downgrade():
    with op.batch_alter_table('login_sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_login_sessions_student_id'))
        batch_op.drop_index(batch_op.f('ix_login_sessions_staff_id'))
        batch_op.drop_index(batch_op.f('ix_login_sessions_expires_at'))
        batch_op.drop_index(batch_op.f('ix_login_sessions_admin_id'))

    op.drop_table('login_sessions')
