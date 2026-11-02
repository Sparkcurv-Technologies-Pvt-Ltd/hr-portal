"""Holiday routes (``/api/holidays``): public list/check, and add/edit/delete for admins
(or employees granted Edit/Delete on the Holidays module)."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.permissions import require_permission
from app.db import execute_query
from app.schemas.holidays import HolidayIn
from app.services.workdays import get_holiday_name, is_holiday, is_weekend


holidays_router = APIRouter(prefix="/holidays")


def _row_out(r: dict) -> dict:
    return {
        "id": str(r["id"]), "date": r["date"], "festival": r["festival"],
        "day": datetime.strptime(r["date"], "%Y-%m-%d").strftime("%A"),
    }

def _validate(data: HolidayIn) -> tuple:
    festival = (data.festival or "").strip()
    if not festival:
        raise HTTPException(status_code=400, detail="Holiday name is required")
    try:
        date = datetime.strptime((data.date or "").strip(), "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be in YYYY-MM-DD format")
    return date, festival[:150]

async def _ensure_date_free(date: str, exclude_id: int = None) -> None:
    clash = await execute_query("SELECT id, festival FROM holidays WHERE date = %s", (date,), fetch_one=True)
    if clash and clash["id"] != exclude_id:
        raise HTTPException(status_code=400, detail=f"{date} is already a holiday ({clash['festival']})")


@holidays_router.get("/list")
async def get_holidays():
    rows = await execute_query("SELECT id, date, festival FROM holidays ORDER BY date", fetch_all=True)
    return [_row_out(r) for r in (rows or [])]

@holidays_router.get("/check/{date}")
async def check_date(date: str):
    weekend = is_weekend(date)
    holiday = await is_holiday(date)
    return {"date": date, "is_weekend": weekend, "is_holiday": holiday, "holiday_name": await get_holiday_name(date) if holiday else "", "is_working_day": not weekend and not holiday}

@holidays_router.post("")
async def create_holiday(data: HolidayIn, request: Request):
    await require_permission(request, "holidays", "edit")
    date, festival = _validate(data)
    await _ensure_date_free(date)
    now = datetime.now(timezone.utc).isoformat()
    new_id = await execute_query(
        "INSERT INTO holidays (date, festival, created_at, updated_at) VALUES (%s, %s, %s, %s)",
        (date, festival, now, now), last_id=True
    )
    return _row_out({"id": new_id, "date": date, "festival": festival})

@holidays_router.put("/{holiday_id}")
async def update_holiday(holiday_id: str, data: HolidayIn, request: Request):
    await require_permission(request, "holidays", "edit")
    date, festival = _validate(data)
    await _ensure_date_free(date, exclude_id=int(holiday_id))
    result = await execute_query(
        "UPDATE holidays SET date = %s, festival = %s, updated_at = %s WHERE id = %s",
        (date, festival, datetime.now(timezone.utc).isoformat(), int(holiday_id))
    )
    if result == 0 and not await execute_query("SELECT id FROM holidays WHERE id = %s", (int(holiday_id),), fetch_one=True):
        raise HTTPException(status_code=404, detail="Holiday not found")
    return _row_out({"id": int(holiday_id), "date": date, "festival": festival})

@holidays_router.delete("/{holiday_id}")
async def delete_holiday(holiday_id: str, request: Request):
    await require_permission(request, "holidays", "delete")
    result = await execute_query("DELETE FROM holidays WHERE id = %s", (int(holiday_id),))
    if result == 0:
        raise HTTPException(status_code=404, detail="Holiday not found")
    return {"message": "Holiday deleted"}
