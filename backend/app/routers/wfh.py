"""Employee work-from-home routes (``/api/wfh``)."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.security import get_current_user
from app.db import execute_query
from app.schemas.wfh import WFHRequest
from app.services.workdays import is_holiday, is_weekend


wfh_router = APIRouter(prefix="/wfh")


@wfh_router.post("/request")
async def create_wfh_request(wfh_data: WFHRequest, request: Request):
    user = await get_current_user(request)
    # Check if date is a working day
    if is_weekend(wfh_data.date) or await is_holiday(wfh_data.date):
        raise HTTPException(status_code=400, detail="Cannot request WFH on weekends or holidays")
    # Check duplicate
    existing = await execute_query(
        "SELECT id FROM wfh_requests WHERE user_id = %s AND date = %s AND status != 'rejected'",
        (user["id"], wfh_data.date), fetch_one=True
    )
    if existing:
        raise HTTPException(status_code=400, detail="WFH request already exists for this date")
    # Check monthly limit
    month_start = wfh_data.date[:7] + "-01"
    month_num = int(wfh_data.date[5:7])
    year_num = int(wfh_data.date[:4])
    if month_num == 12:
        month_end = f"{year_num + 1}-01-01"
    else:
        month_end = f"{year_num}-{month_num + 1:02d}-01"
    used = await execute_query(
        "SELECT COUNT(*) as cnt FROM wfh_requests WHERE user_id = %s AND date >= %s AND date < %s AND status IN ('pending', 'approved')",
        (user["id"], month_start, month_end), fetch_one=True
    )
    wfh_limit = user.get("wfh_limit")  # None = no limit set by admin
    used_count = used["cnt"] if used else 0
    if wfh_limit is not None and used_count >= wfh_limit:
        raise HTTPException(status_code=400, detail=f"Monthly WFH limit reached ({wfh_limit} days). Contact admin to increase your limit.")

    wfh_id = await execute_query(
        """INSERT INTO wfh_requests (user_id, user_name, user_email, date, reason, status, created_at)
           VALUES (%s, %s, %s, %s, %s, 'pending', %s)""",
        (user["id"], user["name"], user.get("email", ""), wfh_data.date, wfh_data.reason, datetime.now(timezone.utc).isoformat()),
        last_id=True
    )
    return {"id": str(wfh_id), "user_id": str(user["id"]), "user_name": user["name"], "date": wfh_data.date, "reason": wfh_data.reason, "status": "pending", "created_at": datetime.now(timezone.utc).isoformat()}

@wfh_router.get("/my-requests")
async def get_my_wfh_requests(request: Request):
    user = await get_current_user(request)
    rows = await execute_query(
        "SELECT * FROM wfh_requests WHERE user_id = %s ORDER BY created_at DESC",
        (user["id"],), fetch_all=True
    )
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        result.append(d)
    return result

@wfh_router.get("/balance")
async def get_wfh_balance(request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    month_start = f"{now.year}-{now.month:02d}-01"
    if now.month == 12:
        month_end = f"{now.year + 1}-01-01"
    else:
        month_end = f"{now.year}-{now.month + 1:02d}-01"
    used = await execute_query(
        "SELECT COUNT(*) as cnt FROM wfh_requests WHERE user_id = %s AND date >= %s AND date < %s AND status IN ('pending', 'approved')",
        (user["id"], month_start, month_end), fetch_one=True
    )
    wfh_limit = user.get("wfh_limit")  # None = admin hasn't set a limit
    used_count = used["cnt"] if used else 0
    remaining = None if wfh_limit is None else max(0, wfh_limit - used_count)
    return {"limit": wfh_limit, "used": used_count, "remaining": remaining}

@wfh_router.delete("/{wfh_id}")
async def cancel_wfh_request(wfh_id: str, request: Request):
    user = await get_current_user(request)
    wfh_req = await execute_query("SELECT * FROM wfh_requests WHERE id = %s", (int(wfh_id),), fetch_one=True)
    if not wfh_req:
        raise HTTPException(status_code=404, detail="WFH request not found")
    if wfh_req["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if wfh_req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Can only cancel pending requests")
    await execute_query("DELETE FROM wfh_requests WHERE id = %s", (int(wfh_id),))
    return {"message": "WFH request cancelled"}
