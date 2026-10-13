import argparse
from getpass import getpass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import database_path
from app.db import make_engine
from app.models import Staff
from app.schemas import StaffCreate


def main():
    parser = argparse.ArgumentParser(description="Create a CampusDine staff account after running migrations.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--username", required=True)
    args = parser.parse_args()
    password = getpass("Password (12–128 characters): ")
    if password != getpass("Confirm password: "):
        parser.exit(1, "Passwords did not match.\n")
    details = StaffCreate(name=args.name, username=args.username, password=password)
    engine = make_engine(database_path())
    try:
        with Session(engine) as db:
            db.add(Staff(name=details.name, username=details.username.lower(), password_hash=hash_password(password)))
            db.commit()
    except IntegrityError:
        parser.exit(1, "That staff username already exists.\n")
    finally:
        engine.dispose()
    print("Staff account created.")


if __name__ == "__main__":
    main()
