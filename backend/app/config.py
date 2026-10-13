import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")
NEPAL_TZ = ZoneInfo("Asia/Kathmandu")


def database_path() -> Path:
    path = Path(os.getenv("CAMPUSDINE_DB_PATH", "data/campusdine.sqlite3"))
    return path if path.is_absolute() else BACKEND_DIR / path
