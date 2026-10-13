"""recommendation_cache"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('recommendation_batch',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('generated_at', sa.DateTime(), nullable=False),
    sa.Column('source_max_order_id', sa.Integer(), nullable=False),
    sa.CheckConstraint('id = 1', name='ck_recommendation_single_batch'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('recommendation_scores',
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('menu_item_id', sa.Integer(), nullable=False),
    sa.Column('history_last_order_id', sa.Integer(), nullable=False),
    sa.Column('score', sa.Float(), nullable=False),
    sa.CheckConstraint('score > 0 AND score <= 1', name='ck_recommendation_score'),
    sa.ForeignKeyConstraint(['menu_item_id'], ['menu_items.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('student_id', 'menu_item_id')
    )


def downgrade():
    op.drop_table('recommendation_scores')
    op.drop_table('recommendation_batch')
