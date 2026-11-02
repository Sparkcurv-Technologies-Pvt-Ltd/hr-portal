"""Change request routes (``/api/cr``)."""

import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.config import CR_TYPES, EXTRA_NOTIFICATION_EMAILS
from app.core.email import _cr_email_html, _send_email
from app.core.log import logger
from app.core.security import get_current_user
from app.db import execute_query
from app.schemas.cr import CRCreate


cr_router = APIRouter(prefix="/cr")


@cr_router.get("/managers")
async def get_cr_managers(request: Request):
    """Return only users flagged as CR approvers by admin."""
    await get_current_user(request)
    rows = await execute_query(
        "SELECT id, name, email, role, department FROM users WHERE is_cr_approver = 1 ORDER BY name",
        fetch_all=True
    )
    return [{"id": str(r["id"]), "name": r["name"], "email": r["email"], "role": r["role"], "department": r.get("department") or ""} for r in (rows or [])]

@cr_router.get("/my-manager")
async def get_my_reporting_manager(request: Request):
    """Return the current user's reporting manager (CRs are always routed to them)."""
    user = await get_current_user(request)
    if not user.get("reporting_manager_id"):
        return {"has_manager": False}
    mgr = await execute_query("SELECT id, name, email, role FROM users WHERE id = %s", (user["reporting_manager_id"],), fetch_one=True)
    if not mgr:
        return {"has_manager": False}
    return {"has_manager": True, "id": str(mgr["id"]), "name": mgr["name"], "email": mgr["email"], "role": mgr["role"]}

@cr_router.post("/create")
async def create_cr(data: CRCreate, request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc).isoformat()
    metadata_json = json.dumps(data.metadata) if data.metadata else None

    # A CR is always routed to the requester's own Reporting Manager (set by Admin)
    if not user.get("reporting_manager_id"):
        raise HTTPException(status_code=400, detail="No reporting manager assigned to you. Please contact Admin to set your reporting manager before submitting a change request.")
    mgr = await execute_query("SELECT id, name, email, role FROM users WHERE id = %s", (user["reporting_manager_id"],), fetch_one=True)
    if not mgr:
        raise HTTPException(status_code=400, detail="Your reporting manager account was not found. Please contact Admin.")

    # Generate unique CR number: CR-YYYY-NNNN
    year = datetime.now(timezone.utc).year
    # MAX of the existing sequence (not COUNT) so numbers are never reused after a delete
    seq_row = await execute_query(
        "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(cr_number, '-', -1) AS UNSIGNED)), 0) as max_seq FROM change_requests WHERE cr_number LIKE 'CR-%'",
        fetch_one=True
    )
    cr_seq = (int(seq_row["max_seq"]) if seq_row else 0) + 1
    cr_number = f"CR-{year}-{cr_seq:04d}"

    cr_id = await execute_query(
        """INSERT INTO change_requests (cr_number, requester_id, requester_name, title, description, cr_type, priority, status, manager_approval, admin_approval, assigned_manager_id, assigned_manager_name, metadata, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', 'pending', 'pending', %s, %s, %s, %s, %s)""",
        (cr_number, user["id"], user["name"], data.title, data.description, data.cr_type, data.priority, mgr["id"], mgr["name"], metadata_json, now, now),
        last_id=True
    )

    cr_row = {
        "id": cr_id, "cr_number": cr_number, "requester_name": user["name"],
        "title": data.title, "description": data.description,
        "cr_type": data.cr_type, "priority": data.priority
    }

    # Notify ONLY the requester's reporting manager — no action links, portal login required
    try:
        mgr_html = _cr_email_html(cr_row, "Reporting Manager")
        subject = f"[{cr_number}] New Change Request: {data.title}"
        asyncio.get_event_loop().run_in_executor(None, _send_email, [mgr["email"]], subject, mgr_html)
        for extra_email in EXTRA_NOTIFICATION_EMAILS:
            if extra_email != mgr["email"]:
                extra_html = _cr_email_html(cr_row, "Notification")
                asyncio.get_event_loop().run_in_executor(None, _send_email, [extra_email], f"[{cr_number}] New CR Submitted: {data.title}", extra_html)
    except Exception as e:
        logger.warning(f"CR email dispatch failed: {e}")

    return {"id": str(cr_id), "cr_number": cr_number, "title": data.title, "status": "pending", "message": "Change request submitted successfully"}

@cr_router.get("/my-requests")
async def get_my_crs(request: Request):
    user = await get_current_user(request)
    crs = await execute_query(
        "SELECT * FROM change_requests WHERE requester_id = %s ORDER BY created_at DESC",
        (user["id"],), fetch_all=True
    )
    result = []
    for cr in (crs or []):
        d = dict(cr)
        d["id"] = str(d.pop("id"))
        d["requester_id"] = str(d["requester_id"])
        if d.get("manager_id"): d["manager_id"] = str(d["manager_id"])
        if d.get("admin_id"): d["admin_id"] = str(d["admin_id"])
        result.append(d)
    return result

@cr_router.delete("/{cr_id}")
async def delete_cr(cr_id: str, request: Request):
    user = await get_current_user(request)
    cr = await execute_query("SELECT * FROM change_requests WHERE id = %s", (int(cr_id),), fetch_one=True)
    if not cr:
        raise HTTPException(status_code=404, detail="CR not found")
    if cr["requester_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    if cr["status"] not in ("pending",):
        raise HTTPException(status_code=400, detail="Can only delete pending CRs")
    await execute_query("DELETE FROM change_requests WHERE id = %s", (int(cr_id),))
    return {"message": "CR deleted"}

@cr_router.get("/types")
async def get_cr_types(request: Request):
    await get_current_user(request)
    return CR_TYPES
