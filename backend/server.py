"""ASGI entry point, kept so `uvicorn server:app` / `gunicorn server:app` (run from backend/) still work.

The application itself lives in the ``app`` package (see app/main.py).
"""
from dotenv import load_dotenv

# Load backend/.env before anything reads os.environ (app.core.config also calls this).
load_dotenv()

from app.main import app  # noqa: E402

__all__ = ["app"]
