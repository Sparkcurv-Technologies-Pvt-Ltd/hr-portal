"""Employee permission (short leave) routes (``/api/permission``)."""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.config import MAX_PERMISSION_PER_USE, MONTHLY_PERMISSION_HOURS, REQUEST_NOTIFY_EMAILS
from app.core.email import _request_email_html, _send_email
from app.core.log import logger
from app.core.security import get_current_user
from app.db import execute_query
from app.schemas.permission import PermissionRequest


permission_router = APIRouter(prefix="/permission")


def _monthly_allowance_hours(user: dict) -> float:
    """Per-employee allowance set by admin (users.permission_hours), else the company default."""
    hours = user.get("permission_hours")
    return float(hours) if hours is not None else MONTHLY_PERMISSION_HOURS


@permission_router.get("/balance")
async def get_permission_balance(request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1).strftime("%Y-%m-%d")

    rows = await execute_query(
        "SELECT duration_minutes FROM permissions WHERE user_id = %s AND date >= %s AND status IN ('approved', 'pending')",
        (user["id"], month_start), fetch_all=True
    )
    used_minutes = sum(r["duration_minutes"] for r in (rows or []))
    allowance_hours = _monthly_allowance_hours(user)
    return {
        "monthly_allowance_hours": allowance_hours, "used_minutes": used_minutes,
        "used_hours": used_minutes / 60, "remaining_minutes": (allowance_hours * 60) - used_minutes,
        "remaining_hours": allowance_hours - (used_minutes / 60), "max_per_use_minutes": MAX_PERMISSION_PER_USE * 60
    }

@permission_router.post("/request")
async def request_permission(perm_data: PermissionRequest, request: Request):
    user = await get_current_user(request)
    if perm_data.duration_minutes > MAX_PERMISSION_PER_USE * 60:
        raise HTTPException(status_code=400, detail=f"Maximum permission duration is {MAX_PERMISSION_PER_USE} hour(s)")
    if perm_data.duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="Invalid duration")

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1).strftime("%Y-%m-%d")
    rows = await execute_query(
        "SELECT duration_minutes FROM permissions WHERE user_id = %s AND date >= %s AND status IN ('approved', 'pending')",
        (user["id"], month_start), fetch_all=True
    )
    used_minutes = sum(r["duration_minutes"] for r in (rows or []))
    remaining = (_monthly_allowance_hours(user) * 60) - used_minutes
    if perm_data.duration_minutes > remaining:
        raise HTTPException(status_code=400, detail=f"Insufficient permission balance. Remaining: {remaining} minutes")

    perm_id = await execute_query(
        "INSERT INTO permissions (user_id, user_name, user_email, duration_minutes, reason, date, status, created_at) VALUES (%s, %s, %s, %s, %s, %s, 'pending', %s)",
        (user["id"], user["name"], user.get("email", ""), perm_data.duration_minutes, perm_data.reason, perm_data.date, now.isoformat()),
        last_id=True
    )

    try:
        html_body = _request_email_html("New Permission Request", user["name"], [
            ("Date", perm_data.date),
            ("Duration", f"{perm_data.duration_minutes} minutes"),
            ("Reason", perm_data.reason or "-"),
        ])
        asyncio.get_event_loop().run_in_executor(None, _send_email, REQUEST_NOTIFY_EMAILS, f"Permission Request: {user['name']} ({perm_data.duration_minutes} min)", html_body)
    except Exception as e:
        logger.warning(f"Permission request email dispatch failed: {e}")

    return {"id": str(perm_id), "user_id": str(user["id"]), "user_name": user["name"], "user_email": user.get("email", ""), "duration_minutes": perm_data.duration_minutes, "reason": perm_data.reason, "date": perm_data.date, "status": "pending", "created_at": now.isoformat(), "reviewed_by": None, "reviewed_at": None}

@permission_router.get("/my-requests")
async def get_my_permission_requests(request: Request):
    user = await get_current_user(request)
    rows = await execute_query("SELECT * FROM permissions WHERE user_id = %s ORDER BY created_at DESC", (user["id"],), fetch_all=True)
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        result.append(d)
    return result

@permission_router.delete("/{permission_id}")
async def cancel_permission(permission_id: str, request: Request):
    user = await get_current_user(request)
    perm = await execute_query("SELECT * FROM permissions WHERE id = %s", (int(permission_id),), fetch_one=True)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission request not found")
    if perm["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if perm["status"] != "pending":
        raise HTTPException(status_code=400, detail="Can only cancel pending requests")
    await execute_query("DELETE FROM permissions WHERE id = %s", (int(permission_id),))
    return {"message": "Permission request cancelled"}
