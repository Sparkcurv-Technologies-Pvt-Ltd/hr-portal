"""Attendance business logic shared by attendance routes (pauses, required hours, short days)."""

from datetime import datetime, timezone

from app.core.config import REQUIRED_WORK_HOURS, SHORT_DAYS_FOR_HALF_LEAVE
from app.db import execute_query


async def check_and_deduct_half_day_leave(user_id: int):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1).strftime("%Y-%m-%d")

    result = await execute_query(
        "SELECT COUNT(*) as cnt FROM attendance WHERE user_id = %s AND is_short_day = 1 AND date >= %s",
        (user_id, month_start), fetch_one=True
    )
    short_days_count = result["cnt"] if result else 0

    if short_days_count > 0 and short_days_count % SHORT_DAYS_FOR_HALF_LEAVE == 0:
        await execute_query(
            "UPDATE users SET casual_leave = casual_leave - 0.5, half_day_leave = half_day_leave + 0.5 WHERE id = %s", (user_id,)
        )
        await execute_query(
            "INSERT INTO leave_deductions (user_id, type, amount, reason, date) VALUES (%s, %s, %s, %s, %s)",
            (user_id, "half_day_short_work", 0.5, f"Auto-deducted for {SHORT_DAYS_FOR_HALF_LEAVE} short working days", now.isoformat())
        )


async def get_pause_data(attendance_id: int):
    pauses_list = await execute_query("SELECT pause_start, pause_end FROM pauses WHERE attendance_id = %s", (attendance_id,), fetch_all=True)
    total_pause = 0
    for p in (pauses_list or []):
        if p["pause_start"] and p["pause_end"]:
            s = datetime.fromisoformat(p["pause_start"])
            e = datetime.fromisoformat(p["pause_end"])
            total_pause += (e - s).total_seconds() / 60
    formatted = [{"start": p["pause_start"], "end": p["pause_end"]} for p in (pauses_list or [])]
    return formatted, total_pause

async def get_approved_permission_minutes(user_id: int, date: str) -> int:
    """Sum of approved permission minutes for a user on a given date — reduces the required work hours for the day."""
    rows = await execute_query(
        "SELECT duration_minutes FROM permissions WHERE user_id = %s AND date = %s AND status = 'approved'",
        (user_id, date), fetch_all=True
    )
    return sum(r["duration_minutes"] for r in (rows or []))

async def has_approved_half_day_leave(user_id: int, date: str) -> bool:
    """True if the employee has an approved half-day leave for this date — halves the required work hours."""
    row = await execute_query(
        "SELECT id FROM leave_requests WHERE user_id = %s AND is_half_day = 1 AND status = 'approved' AND start_date = %s",
        (user_id, date), fetch_one=True
    )
    return bool(row)

async def get_effective_required_minutes(user_id: int, date: str) -> tuple:
    """Returns (required_minutes, permission_minutes, is_half_day) after applying half-day leave + permission reductions."""
    permission_minutes = await get_approved_permission_minutes(user_id, date)
    is_half_day = await has_approved_half_day_leave(user_id, date)
    base_minutes = (REQUIRED_WORK_HOURS * 60) / 2 if is_half_day else (REQUIRED_WORK_HOURS * 60)
    required_minutes = max(0, base_minutes - permission_minutes)
    return required_minutes, permission_minutes, is_half_day
