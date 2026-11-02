"""Employee leave routes (``/api/leave``)."""

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.config import REQUEST_NOTIFY_EMAILS
from app.core.email import _request_email_html, _send_email
from app.core.log import logger
from app.core.security import get_current_user
from app.db import execute_query
from app.schemas.leave import LeaveRequest
from app.services.workdays import get_holiday_map, is_weekend


leave_router = APIRouter(prefix="/leave")


@leave_router.get("/balance")
async def get_leave_balance(request: Request):
    user = await get_current_user(request)
    return {"casual": user.get("casual_leave"), "sick": user.get("sick_leave"), "loss_of_pay": user.get("loss_of_pay", 0), "wfh_limit": user.get("wfh_limit")}

@leave_router.post("/request")
async def create_leave_request(leave_data: LeaveRequest, request: Request):
    user = await get_current_user(request)

    start = datetime.strptime(leave_data.start_date, "%Y-%m-%d")
    end = datetime.strptime(leave_data.end_date, "%Y-%m-%d")

    # For half-day leave, start and end must be same date
    if leave_data.is_half_day:
        if leave_data.start_date != leave_data.end_date:
            raise HTTPException(status_code=400, detail="Half-day leave must be for a single date")
        working_days = 0.5
    else:
        working_days = 0
        holiday_dates = await get_holiday_map()
        current = start
        while current <= end:
            date_str = current.strftime("%Y-%m-%d")
            if not is_weekend(date_str) and date_str not in holiday_dates:
                working_days += 1
            current += timedelta(days=1)

    if working_days == 0:
        raise HTTPException(status_code=400, detail="Selected dates only contain weekends/holidays")

    # Monthly leave limit check (1.5 days per month) - skip for loss_of_pay
    if leave_data.leave_type != "loss_of_pay":
        month_start = start.strftime("%Y-%m") + "-01"
        month_num = start.month
        year_num = start.year
        if month_num == 12:
            month_end = f"{year_num + 1}-01-01"
        else:
            month_end = f"{year_num}-{month_num + 1:02d}-01"

        used_this_month = await execute_query(
            "SELECT COALESCE(SUM(days), 0) as total FROM leave_requests WHERE user_id = %s AND start_date >= %s AND start_date < %s AND status IN ('pending', 'approved') AND leave_type != 'loss_of_pay'",
            (user["id"], month_start, month_end), fetch_one=True
        )
        used = float(used_this_month["total"]) if used_this_month else 0
        if used + working_days > 1.5:
            remaining = max(0, 1.5 - used)
            raise HTTPException(status_code=400, detail=f"Monthly leave limit is 1.5 days. Used: {used}, Remaining: {remaining}")

        # Check leave balance
        leave_field = f"{leave_data.leave_type}_leave"
        current_balance = float(user.get(leave_field) or 0)
        if working_days > current_balance:
            raise HTTPException(status_code=400, detail=f"Insufficient {leave_data.leave_type} leave balance")

    leave_id = await execute_query(
        """INSERT INTO leave_requests (user_id, user_name, user_email, leave_type, start_date, end_date, days, reason, status, created_at, is_half_day)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s)""",
        (user["id"], user["name"], user.get("email", ""), leave_data.leave_type, leave_data.start_date, leave_data.end_date, working_days, leave_data.reason, datetime.now(timezone.utc).isoformat(), 1 if leave_data.is_half_day else 0),
        last_id=True
    )

    try:
        leave_label = leave_data.leave_type.replace("_", " ").title()
        dates = leave_data.start_date if leave_data.start_date == leave_data.end_date else f"{leave_data.start_date} to {leave_data.end_date}"
        html_body = _request_email_html("New Leave Request", user["name"], [
            ("Leave Type", f"{leave_label}{' (Half Day)' if leave_data.is_half_day else ''}"),
            ("Dates", f"{dates} ({working_days} day{'s' if working_days != 1 else ''})"),
            ("Reason", leave_data.reason or "-"),
        ])
        asyncio.get_event_loop().run_in_executor(None, _send_email, REQUEST_NOTIFY_EMAILS, f"Leave Request: {user['name']} ({leave_label})", html_body)
    except Exception as e:
        logger.warning(f"Leave request email dispatch failed: {e}")

    return {"id": str(leave_id), "user_id": str(user["id"]), "user_name": user["name"], "user_email": user.get("email", ""), "leave_type": leave_data.leave_type, "start_date": leave_data.start_date, "end_date": leave_data.end_date, "days": working_days, "reason": leave_data.reason, "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(), "reviewed_by": None, "reviewed_at": None, "is_half_day": leave_data.is_half_day}

@leave_router.get("/my-requests")
async def get_my_leave_requests(request: Request):
    user = await get_current_user(request)
    rows = await execute_query(
        "SELECT * FROM leave_requests WHERE user_id = %s ORDER BY created_at DESC",
        (user["id"],), fetch_all=True
    )
    result = []
    for r in (rows or []):
        result.append({
            "id": str(r["id"]), "user_id": str(r["user_id"]), "user_name": r["user_name"], "user_email": r["user_email"],
            "leave_type": r["leave_type"], "start_date": r["start_date"], "end_date": r["end_date"],
            "days": r["days"], "reason": r["reason"], "status": r["status"],
            "created_at": r["created_at"], "reviewed_by": r["reviewed_by"], "reviewed_at": r["reviewed_at"],
            "is_half_day": bool(r.get("is_half_day", 0))
        })
    return result

@leave_router.get("/monthly-usage")
async def get_monthly_leave_usage(request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    month_start = f"{now.year}-{now.month:02d}-01"
    if now.month == 12:
        month_end = f"{now.year + 1}-01-01"
    else:
        month_end = f"{now.year}-{now.month + 1:02d}-01"
    used = await execute_query(
        "SELECT COALESCE(SUM(days), 0) as total FROM leave_requests WHERE user_id = %s AND start_date >= %s AND start_date < %s AND status IN ('pending', 'approved') AND leave_type != 'loss_of_pay'",
        (user["id"], month_start, month_end), fetch_one=True
    )
    used_days = float(used["total"]) if used else 0
    return {"monthly_limit": 1.5, "used": used_days, "remaining": max(0, 1.5 - used_days)}

@leave_router.delete("/{leave_id}")
async def cancel_leave_request(leave_id: str, request: Request):
    user = await get_current_user(request)
    leave_req = await execute_query("SELECT * FROM leave_requests WHERE id = %s", (int(leave_id),), fetch_one=True)
    if not leave_req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if leave_req["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if leave_req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Can only cancel pending requests")
    await execute_query("DELETE FROM leave_requests WHERE id = %s", (int(leave_id),))
    return {"message": "Leave request cancelled"}
