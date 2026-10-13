import logging

from app.config import database_path
from app.db import make_engine
from app.notifications import retry_due


def main():
    logging.basicConfig(level=logging.INFO)
    engine = make_engine(database_path())
    try:
        logging.info("Sent %s queued emails", retry_due(engine))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
