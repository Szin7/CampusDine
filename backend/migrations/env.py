from alembic import context

from app.config import database_path
from app.db import Base, make_engine
from app import models  # noqa: F401


def run_migrations_online():
    engine = make_engine(database_path())
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
            render_as_batch=True,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Run migrations against a local SQLite database.")
else:
    run_migrations_online()
