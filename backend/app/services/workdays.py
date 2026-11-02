"""Weekend/holiday checks and shift-string parsing."""

from datetime import datetime

from app.core.config import DEFAULT_SHIFT_END, DEFAULT_SHIFT_START
from app.db import execute_query


def is_weekend(date_str: str) -> bool:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return d.weekday() in (5, 6)

async def get_holiday_map() -> dict:
    """``{"YYYY-MM-DD": festival}`` for every holiday (admin-managed ``holidays`` table)."""
    rows = await execute_query("SELECT date, festival FROM holidays", fetch_all=True)
    return {r["date"]: r["festival"] for r in (rows or [])}

async def is_holiday(date_str: str) -> bool:
    row = await execute_query("SELECT id FROM holidays WHERE date = %s", (date_str,), fetch_one=True)
    return bool(row)

async def get_holiday_name(date_str: str) -> str:
    row = await execute_query("SELECT festival FROM holidays WHERE date = %s", (date_str,), fetch_one=True)
    return row["festival"] if row else ""


def parse_shift(shift_str: str) -> dict:
    """Parse shift string 'HH:MM-HH:MM' into start/end dict."""
    if shift_str and "-" in shift_str:
        parts = shift_str.split("-", 1)
        if len(parts) == 2:
            return {"start": parts[0].strip(), "end": parts[1].strip()}
    return {"start": DEFAULT_SHIFT_START, "end": DEFAULT_SHIFT_END}
