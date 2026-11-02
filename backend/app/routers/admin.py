"""Admin/manager routes (``/api/admin``).

All admin endpoints share one router, kept in a single module so their registration
order is identical to the original server.py.
"""

import asyncio
import json
import logging
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile

from app.core.config import APP_TIMEZONE, DEFAULT_SHIFT_END, DEFAULT_SHIFT_START, MONTHLY_PERMISSION_HOURS, REQUEST_NOTIFY_EMAILS, WORKING_DAYS_PER_MONTH
from app.core.email import _cr_email_html, _request_email_html, _send_email
from app.core.log import logger
from app.core.permissions import MODULES, forbid_granted_on_admin, get_module_permissions, has_permission, require_any_view, require_permission
from app.core.security import get_current_user, hash_password, require_admin, verify_password
from app.db import execute_query
from app.schemas.admin import OfficeSettingsUpdate, OrgNodeCreate, OrgNodeUpdate, ResetPortalRequest
from app.schemas.auth import UserRegister
from app.schemas.employees import EmployeeUpdate, PasswordReset, SalaryUpdate, ShiftAssign
from app.schemas.leave import LeaveBalanceUpdate
from app.schemas.payroll import BulkPayrollGenerate, CustomDeductionCreate, PayslipGenerate
from app.services.geofence import get_office_settings
from app.services.media import _get_image_db, _save_image_db
from app.services.payroll import _get_salary_components, _run_bulk_payroll, email_payslips_in_background, send_payslip_email


admin_router = APIRouter(prefix="/admin")


@admin_router.get("/employees")
async def get_all_employees(request: Request):
    viewer = await require_any_view(request, allow_manager=True)
    # Granted (non-admin) viewers only see salaries with Payroll view access
    hide_salary = viewer.get("_granted") and not has_permission(await get_module_permissions(viewer["id"]), "payroll", "view")
    rows = await execute_query("SELECT id, email, name, role, department, position, avatar_url, created_at, casual_leave, sick_leave, loss_of_pay, permission_hours, half_day_leave, shift, basic_salary, employee_code, wfh_limit, gps_tracking_enabled, timer_access_enabled, full_day_required, reporting_manager_id, is_cr_approver, date_of_birth FROM users ORDER BY created_at DESC", fetch_all=True)
    result = []
    for emp in (rows or []):
        e = dict(emp)
        e["id"] = str(e.pop("id"))
        e["gps_tracking_enabled"] = bool(int(e["gps_tracking_enabled"]) if e.get("gps_tracking_enabled") is not None else 1)
        e["timer_access_enabled"] = bool(int(e["timer_access_enabled"]) if e.get("timer_access_enabled") is not None else 0)
        e["full_day_required"] = bool(int(e["full_day_required"])) if e.get("full_day_required") is not None else True
        if hide_salary:
            e.pop("basic_salary", None)
        result.append(e)
    return result

@admin_router.get("/next-employee-code")
async def get_next_employee_code(request: Request):
    await require_permission(request, "employees", "edit")
    max_code = await execute_query("SELECT employee_code FROM users WHERE employee_code LIKE 'SC%' ORDER BY employee_code DESC LIMIT 1", fetch_one=True)
    next_num = 24001
    if max_code and max_code["employee_code"]:
        try:
            next_num = int(max_code["employee_code"][2:]) + 1
        except ValueError:
            pass
    return {"next_code": f"SC{next_num}"}

@admin_router.post("/employees")
async def create_employee(user_data: UserRegister, request: Request):
    await require_permission(request, "employees", "edit")
    email = user_data.email.lower()
    existing = await execute_query("SELECT id FROM users WHERE email = %s", (email,), fetch_one=True)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    role = user_data.role if user_data.role in ("employee", "manager") else "employee"
    hashed = hash_password(user_data.password)

    # Generate next employee code (SC24001, SC24002, ...) or use provided
    if user_data.employee_code and user_data.employee_code.strip():
        custom_code = user_data.employee_code.strip().upper()
        dup = await execute_query("SELECT id FROM users WHERE employee_code = %s", (custom_code,), fetch_one=True)
        if dup:
            raise HTTPException(status_code=400, detail=f"Employee code '{custom_code}' already exists")
        employee_code = custom_code
    else:
        max_code = await execute_query("SELECT employee_code FROM users WHERE employee_code LIKE 'SC%' ORDER BY employee_code DESC LIMIT 1", fetch_one=True)
        next_num = 24001
        if max_code and max_code["employee_code"]:
            try:
                next_num = int(max_code["employee_code"][2:]) + 1
            except ValueError:
                pass
        employee_code = f"SC{next_num}"

    user_id = await execute_query(
        """INSERT INTO users (email, password_hash, name, role, department, position, avatar_url, created_at, casual_leave, sick_leave, loss_of_pay, permission_hours, half_day_leave, shift, employee_code, wfh_limit, date_of_birth)
           VALUES (%s, %s, %s, %s, %s, %s, '', %s, 12, 3, 0, %s, 0, '', %s, 4, %s)""",
        (email, hashed, user_data.name, role, user_data.department, user_data.position, datetime.now(timezone.utc).isoformat(), MONTHLY_PERMISSION_HOURS, employee_code, user_data.date_of_birth),
        last_id=True
    )

    return {"id": str(user_id), "email": email, "name": user_data.name, "role": role, "department": user_data.department, "position": user_data.position, "avatar_url": "", "casual_leave": None, "sick_leave": None, "loss_of_pay": 0, "permission_hours": MONTHLY_PERMISSION_HOURS, "half_day_leave": 0, "shift": "", "employee_code": employee_code, "wfh_limit": None, "date_of_birth": user_data.date_of_birth}

@admin_router.put("/employees/{employee_id}")
async def update_employee(employee_id: str, update_data: EmployeeUpdate, request: Request):
    editor = await require_permission(request, "employees", "edit")
    # Use model_fields_set so explicitly-sent null values are included (to clear fields)
    update_dict = {k: v for k, v in update_data.model_dump().items() if k in update_data.model_fields_set}
    if not update_dict:
        raise HTTPException(status_code=400, detail="No update data provided")
    target = await execute_query("SELECT role FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    forbid_granted_on_admin(editor, target, update_dict.get("role"))

    # Validate role if being changed
    if "role" in update_dict and update_dict["role"] not in ("employee", "manager", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")

    # Validate employee_code uniqueness if being changed
    if "employee_code" in update_dict and update_dict["employee_code"]:
        code = update_dict["employee_code"].strip().upper()
        update_dict["employee_code"] = code
        dup = await execute_query("SELECT id FROM users WHERE employee_code = %s AND id != %s", (code, int(employee_id)), fetch_one=True)
        if dup:
            raise HTTPException(status_code=400, detail=f"Employee code '{code}' already assigned to another employee")

    set_clause = ", ".join([f"{k} = %s" for k in update_dict])
    values = list(update_dict.values()) + [int(employee_id)]
    await execute_query(f"UPDATE users SET {set_clause} WHERE id = %s", tuple(values))

    emp = await execute_query("SELECT id, email, name, role, department, position, avatar_url, casual_leave, sick_leave, loss_of_pay, permission_hours, half_day_leave, shift, basic_salary, employee_code, wfh_limit, reporting_manager_id, date_of_birth FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    emp["id"] = str(emp.pop("id"))
    return emp

@admin_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, request: Request):
    await require_permission(request, "employees", "delete")
    result = await execute_query("DELETE FROM users WHERE id = %s AND role != 'admin'", (int(employee_id),))
    if result == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    # Access grants must not outlive the account (a reused id would otherwise inherit them)
    await execute_query("DELETE FROM vault_shares WHERE user_id = %s", (int(employee_id),))
    await execute_query("DELETE FROM user_permissions WHERE user_id = %s", (int(employee_id),))
    return {"message": "Employee deleted"}

@admin_router.put("/employees/{employee_id}/gps-tracking")
async def toggle_gps_tracking(employee_id: str, request: Request):
    """Admin can enable or disable GPS tracking for an employee."""
    await require_permission(request, "employees", "edit")
    body = await request.json()
    enabled = bool(body.get("gps_tracking_enabled", True))
    result = await execute_query(
        "UPDATE users SET gps_tracking_enabled = %s WHERE id = %s AND role != 'admin'",
        (int(enabled), int(employee_id))
    )
    if result == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": f"GPS tracking {'enabled' if enabled else 'disabled'}", "gps_tracking_enabled": enabled}

@admin_router.put("/employees/{employee_id}/full-day-rule")
async def toggle_full_day_rule(employee_id: str, request: Request):
    """Switch the 8-hour Logout rule for one employee. Off = they can log out any time
    (days under 8 hours are still recorded as short days)."""
    await require_permission(request, "employees", "edit")
    body = await request.json()
    required = bool(body.get("full_day_required", True))
    result = await execute_query(
        "UPDATE users SET full_day_required = %s WHERE id = %s AND role != 'admin'",
        (int(required), int(employee_id))
    )
    if result == 0 and not await execute_query("SELECT id FROM users WHERE id = %s AND role != 'admin'", (int(employee_id),), fetch_one=True):
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": f"8-hour rule {'on' if required else 'off'}", "full_day_required": required}

@admin_router.put("/employees/{employee_id}/timer-access")
async def toggle_timer_access(employee_id: str, request: Request):
    """Admin can enable or disable flexible timer access for an employee."""
    await require_permission(request, "employees", "edit")
    body = await request.json()
    enabled = bool(body.get("timer_access_enabled", False))
    result = await execute_query(
        "UPDATE users SET timer_access_enabled = %s WHERE id = %s AND role != 'admin'",
        (int(enabled), int(employee_id))
    )
    if result == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": f"Timer access {'enabled' if enabled else 'disabled'}", "timer_access_enabled": enabled}

@admin_router.put("/employees/{employee_id}/cr-approver")
async def toggle_cr_approver(employee_id: str, request: Request):
    """Admin can flag any user as a CR approver — they appear in the CR manager dropdown."""
    await require_permission(request, "employees", "edit")
    body = await request.json()
    enabled = bool(body.get("is_cr_approver", False))
    result = await execute_query(
        "UPDATE users SET is_cr_approver = %s WHERE id = %s",
        (int(enabled), int(employee_id))
    )
    if result == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"CR approver {'enabled' if enabled else 'disabled'}", "is_cr_approver": enabled}

@admin_router.post("/employees/{employee_id}/reset-password")
async def reset_employee_password(employee_id: str, data: PasswordReset, request: Request):
    await require_permission(request, "employees", "edit")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    hashed = hash_password(data.new_password)
    result = await execute_query("UPDATE users SET password_hash = %s WHERE id = %s AND role != 'admin'", (hashed, int(employee_id)))
    if result == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Password reset successfully"}

@admin_router.post("/employees/{employee_id}/avatar")
async def upload_employee_avatar(employee_id: str, request: Request, file: UploadFile = File(...)):
    await require_permission(request, "employees", "edit")
    
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF images allowed")
    
    # Validate file size (max 5MB)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be under 5MB")
    
    # Check employee exists
    emp = await execute_query("SELECT id FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Save to MySQL media table
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    filename = f"avatar_{employee_id}_{_uuid.uuid4().hex[:8]}.{ext}"

    try:
        media_id = await _save_image_db(contents, filename)
    except Exception as e:
        logging.error(f"Avatar upload failed: {e}")
        raise HTTPException(status_code=500, detail="Avatar upload failed")

    avatar_url = f"/api/admin/avatars/{media_id}"
    await execute_query("UPDATE users SET avatar_url = %s WHERE id = %s", (avatar_url, int(employee_id)))
    return {"message": "Avatar uploaded", "avatar_url": avatar_url}

@admin_router.get("/avatars/{media_id}")
async def serve_avatar(media_id: str):
    """Serve avatar images from MySQL media table."""
    try:
        data, content_type = await _get_image_db(media_id)
        return Response(content=data, media_type=content_type, headers={
            "Cache-Control": "public, max-age=86400"
        })
    except Exception as e:
        logging.error(f"Avatar fetch failed for {media_id}: {e}")
        raise HTTPException(status_code=404, detail="Avatar not found")


@admin_router.put("/employees/{employee_id}/leave-balance")
async def update_leave_balance(employee_id: str, data: LeaveBalanceUpdate, request: Request):
    await require_permission(request, "employees", "edit")
    emp = await execute_query("SELECT id FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    fields, values = [], []
    # All fields: sent as null = clear to null, not sent = skip
    for field in ["casual_leave", "sick_leave", "loss_of_pay", "permission_hours", "wfh_limit"]:
        if field in data.model_fields_set:
            fields.append(f"{field} = %s"); values.append(getattr(data, field))
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    values.append(int(employee_id))
    await execute_query(f"UPDATE users SET {', '.join(fields)} WHERE id = %s", tuple(values))
    return {"message": "Leave balance updated successfully"}

@admin_router.get("/employees/{employee_id}/leave-balance")
async def get_employee_leave_balance(employee_id: str, request: Request):
    await require_permission(request, "employees", "view")
    emp = await execute_query(
        "SELECT casual_leave, sick_leave, loss_of_pay, permission_hours, wfh_limit FROM users WHERE id = %s",
        (int(employee_id),), fetch_one=True
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@admin_router.get("/org-chart")
async def get_org_chart(request: Request):
    await get_current_user(request)  # any logged in user can view
    rows = await execute_query(
        "SELECT * FROM org_chart ORDER BY sort_order ASC, id ASC",
        fetch_all=True
    )
    return rows or []


@admin_router.put("/org-levels")
async def save_org_levels(request: Request):
    await require_permission(request, "org-chart", "edit")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(body, list):
        raise HTTPException(status_code=400, detail="Expected a list of {level_num, label}")
    now = datetime.now(timezone.utc).isoformat()
    for item in body:
        lnum = int(item.get("level_num", 0))
        label = str(item.get("label", f"Level {lnum + 1}")).strip() or f"Level {lnum + 1}"
        await execute_query(
            "INSERT INTO org_levels (level_num, label, updated_at) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE label=%s, updated_at=%s",
            (lnum, label, now, label, now)
        )
    return {"message": "Org levels saved"}

@admin_router.post("/org-chart")
async def create_org_node(data: OrgNodeCreate, request: Request):
    await require_permission(request, "org-chart", "edit")
    from datetime import datetime, timezone as tz
    now = datetime.now(tz.utc).isoformat()
    result = await execute_query(
        "INSERT INTO org_chart (parent_id, employee_name, job_title, image_url, description, level_num, sort_order, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (data.parent_id, data.employee_name, data.job_title, data.image_url, data.description, data.level_num or 0, data.sort_order, now),
        last_id=True
    )
    return {"id": result, "message": "Node created"}

@admin_router.put("/org-chart/{node_id}")
async def update_org_node(node_id: int, data: OrgNodeUpdate, request: Request):
    await require_permission(request, "org-chart", "edit")
    fields, values = [], []
    if data.employee_name is not None: fields.append("employee_name=%s"); values.append(data.employee_name)
    if data.job_title is not None: fields.append("job_title=%s"); values.append(data.job_title)
    if data.image_url is not None: fields.append("image_url=%s"); values.append(data.image_url)
    if data.description is not None: fields.append("description=%s"); values.append(data.description)
    if "parent_id" in data.model_fields_set: fields.append("parent_id=%s"); values.append(data.parent_id)
    if data.level_num is not None: fields.append("level_num=%s"); values.append(data.level_num)
    if data.sort_order is not None: fields.append("sort_order=%s"); values.append(data.sort_order)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")
    values.append(node_id)
    await execute_query(f"UPDATE org_chart SET {', '.join(fields)} WHERE id=%s", tuple(values))
    return {"message": "Node updated"}

@admin_router.delete("/org-chart/{node_id}")
async def delete_org_node(node_id: int, request: Request):
    await require_permission(request, "org-chart", "delete")
    # Re-parent children to deleted node's parent
    node = await execute_query("SELECT parent_id FROM org_chart WHERE id=%s", (node_id,), fetch_one=True)
    if node:
        await execute_query("UPDATE org_chart SET parent_id=%s WHERE parent_id=%s", (node["parent_id"], node_id))
    await execute_query("DELETE FROM org_chart WHERE id=%s", (node_id,))
    return {"message": "Node deleted"}

@admin_router.post("/org-chart/{node_id}/image")
async def upload_org_node_image(node_id: int, file: UploadFile = File(...), request: Request = None):
    await require_permission(request, "org-chart", "edit")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 5MB)")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    filename = f"org_{node_id}_{_uuid.uuid4().hex[:8]}.{ext}"
    try:
        media_id = await _save_image_db(contents, filename)
    except Exception as e:
        logging.error(f"Org node image upload failed for node {node_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image upload failed: {str(e)}")
    image_url = f"/api/admin/avatars/{media_id}"
    await execute_query("UPDATE org_chart SET image_url=%s WHERE id=%s", (image_url, node_id))
    return {"image_url": image_url}

# ── Role Permissions ──────────────────────────────────────────────────────────
@admin_router.get("/employees/{employee_id}/permissions")
async def get_employee_permissions(employee_id: str, request: Request):
    await require_admin(request)
    return {"modules": MODULES, "permissions": await get_module_permissions(int(employee_id))}

async def _replace_employee_permissions(employee_id: int, grants: dict, now: str) -> None:
    """Replace one employee's grants. ``grants``: {module: {view, edit, delete}}; edit/delete imply view."""
    await execute_query("DELETE FROM user_permissions WHERE user_id = %s", (employee_id,))
    for module, flags in (grants or {}).items():
        if module not in MODULES or not isinstance(flags, dict):
            continue
        can_edit, can_delete = bool(flags.get("edit")), bool(flags.get("delete"))
        can_view = bool(flags.get("view")) or can_edit or can_delete
        if can_view:
            await execute_query(
                "INSERT INTO user_permissions (user_id, module, can_view, can_edit, can_delete, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (employee_id, module, int(can_view), int(can_edit), int(can_delete), now)
            )

@admin_router.put("/employees/{employee_id}/permissions")
async def set_employee_permissions(employee_id: str, request: Request):
    """Replace one employee's grants. Body: {module: {view, edit, delete}}."""
    await require_admin(request)
    target = await execute_query("SELECT id, role FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _replace_employee_permissions(int(employee_id), await request.json(), datetime.now(timezone.utc).isoformat())
    return {"message": "Permissions updated", "permissions": await get_module_permissions(int(employee_id))}

@admin_router.get("/access-matrix")
async def get_access_matrix(request: Request):
    """Every non-admin employee with their module grants (admins always have full access)."""
    await require_admin(request)
    users = await execute_query(
        "SELECT id, name, email, role, department, employee_code, avatar_url FROM users WHERE role != 'admin' ORDER BY name",
        fetch_all=True
    )
    rows = await execute_query("SELECT user_id, module, can_view, can_edit, can_delete FROM user_permissions", fetch_all=True)
    grants = {}
    for r in (rows or []):
        grants.setdefault(r["user_id"], {})[r["module"]] = {"view": bool(r["can_view"]), "edit": bool(r["can_edit"]), "delete": bool(r["can_delete"])}
    return {
        "modules": MODULES,
        "employees": [{**{k: u[k] for k in ("name", "email", "role", "department", "employee_code", "avatar_url")}, "id": str(u["id"]), "permissions": grants.get(u["id"], {})} for u in (users or [])],
    }

@admin_router.put("/access-matrix")
async def save_access_matrix(request: Request):
    """Bulk replace grants. Body: {employee_id: {module: {view, edit, delete}}} — only listed employees change."""
    await require_admin(request)
    body = await request.json()
    now = datetime.now(timezone.utc).isoformat()
    updated = 0
    for employee_id, grants in (body or {}).items():
        target = await execute_query("SELECT role FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
        if not target or target["role"] == "admin":
            continue
        await _replace_employee_permissions(int(employee_id), grants, now)
        updated += 1
    return {"message": f"Access updated for {updated} employee{'s' if updated != 1 else ''}", "updated": updated}

@admin_router.get("/role-permissions")
async def get_role_permissions(request: Request):
    await require_admin(request)
    rows = await execute_query("SELECT role, feature_key, enabled FROM role_permissions ORDER BY role, feature_key", fetch_all=True)
    result = {}
    for r in (rows or []):
        role = r["role"]
        if role not in result:
            result[role] = {}
        result[role][r["feature_key"]] = bool(r["enabled"])
    return result

@admin_router.put("/role-permissions")
async def update_role_permissions(request: Request):
    await require_admin(request)
    body = await request.json()  # { role: { feature_key: bool, ... }, ... }
    for role, features in body.items():
        if role not in ("manager", "employee"):
            continue
        for feature_key, enabled in features.items():
            await execute_query(
                "INSERT INTO role_permissions (role, feature_key, enabled) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE enabled=%s",
                (role, feature_key, int(bool(enabled)), int(bool(enabled)))
            )
    return {"message": "Permissions updated"}


@admin_router.get("/leave-requests")
async def get_all_leave_requests(request: Request, status: Optional[str] = None):
    user = await require_permission(request, "leaves", "view", allow_manager=True)
    query = "SELECT * FROM leave_requests"
    args = []
    conditions = []
    if status:
        conditions.append("status = %s")
        args.append(status)
    # Managers only see leave requests from their direct reports
    if user["role"] in ("manager",):
        conditions.append("user_id IN (SELECT id FROM users WHERE reporting_manager_id = %s)")
        args.append(user["id"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY created_at DESC"
    rows = await execute_query(query, tuple(args) if args else None, fetch_all=True)
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        result.append(d)
    return result

def _decision_recipients(employee_email: Optional[str]) -> list[str]:
    """The requesting employee plus the request notification list, without duplicates."""
    recipients = [employee_email] if employee_email else []
    return recipients + [e for e in REQUEST_NOTIFY_EMAILS if e.lower() != (employee_email or "").lower()]


@admin_router.put("/leave-requests/{leave_id}")
async def review_leave_request(leave_id: str, request: Request, action: str):
    reviewer = await require_permission(request, "leaves", "edit", allow_manager=True)
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Invalid action")

    leave_req = await execute_query("SELECT * FROM leave_requests WHERE id = %s", (int(leave_id),), fetch_one=True)
    if not leave_req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if leave_req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Leave request already processed")

    new_status = "approved" if action == "approve" else "rejected"
    await execute_query(
        "UPDATE leave_requests SET status = %s, reviewed_by = %s, reviewed_at = %s WHERE id = %s",
        (new_status, reviewer["name"], datetime.now(timezone.utc).isoformat(), int(leave_id))
    )

    if action == "approve":
        if leave_req["leave_type"] == "loss_of_pay":
            await execute_query("UPDATE users SET loss_of_pay = loss_of_pay + %s WHERE id = %s", (leave_req["days"], leave_req["user_id"]))
        else:
            leave_field = f"{leave_req['leave_type']}_leave"
            await execute_query(f"UPDATE users SET {leave_field} = {leave_field} - %s WHERE id = %s", (leave_req["days"], leave_req["user_id"]))

    try:
        leave_label = leave_req["leave_type"].replace("_", " ").title()
        dates = leave_req["start_date"] if leave_req["start_date"] == leave_req["end_date"] else f"{leave_req['start_date']} to {leave_req['end_date']}"
        html_body = _request_email_html(f"Leave Request {new_status.title()}", leave_req["user_name"], [
            ("Leave Type", f"{leave_label}{' (Half Day)' if leave_req.get('is_half_day') else ''}"),
            ("Dates", f"{dates} ({leave_req['days']} day{'s' if leave_req['days'] != 1 else ''})"),
            ("Status", f"{new_status.title()} by {reviewer['name']}"),
        ], message="Log in to the HR Portal for details.")
        asyncio.get_event_loop().run_in_executor(None, _send_email, _decision_recipients(leave_req.get("user_email")), f"Leave {new_status.title()}: {leave_req['user_name']} ({leave_label})", html_body)
    except Exception as e:
        logger.warning(f"Leave decision email dispatch failed: {e}")

    return {"message": f"Leave request {new_status}"}

@admin_router.get("/attendance")
async def get_all_attendance(request: Request, date: Optional[str] = None):
    user = await require_permission(request, "attendance", "view", allow_manager=True)
    query = "SELECT * FROM attendance"
    args = []
    conditions = []
    if date:
        conditions.append("date = %s")
        args.append(date)
    if user["role"] in ("manager",):
        conditions.append("user_id IN (SELECT id FROM users WHERE reporting_manager_id = %s)")
        args.append(user["id"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY date DESC LIMIT 1000"
    rows = await execute_query(query, tuple(args) if args else None, fetch_all=True)

    result = []
    for rec in (rows or []):
        result.append({
            "user_id": str(rec["user_id"]), "user_name": rec["user_name"], "date": rec["date"],
            "clock_in": rec["clock_in"], "clock_out": rec["clock_out"],
            "working_hours": rec.get("working_hours"), "is_short_day": bool(rec.get("is_short_day")),
            "is_emergency_clockout": bool(rec.get("is_emergency_clockout")), "emergency_reason": rec.get("emergency_reason"),
            "clock_in_lat": rec.get("clock_in_lat"), "clock_in_lng": rec.get("clock_in_lng"),
            "clock_in_address": rec.get("clock_in_address"),
            "clock_out_address": rec.get("clock_out_address"),
            "location_type": rec.get("location_type"),
        })
    return result

@admin_router.get("/analytics")
async def get_analytics(request: Request):
    await require_any_view(request, allow_manager=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    total_emp = await execute_query("SELECT COUNT(*) as cnt FROM users WHERE role IN ('employee', 'manager')", fetch_one=True)
    present = await execute_query("SELECT COUNT(*) as cnt FROM attendance WHERE date = %s", (today,), fetch_one=True)
    pending = await execute_query("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'", fetch_one=True)

    # On break
    today_att = await execute_query("SELECT id FROM attendance WHERE date = %s AND clock_out IS NULL", (today,), fetch_all=True)
    on_break = 0
    for att in (today_att or []):
        ab = await execute_query("SELECT id FROM breaks WHERE attendance_id = %s AND break_end IS NULL", (att["id"],), fetch_one=True)
        if ab:
            on_break += 1

    # Department breakdown
    dept = await execute_query("SELECT department, COUNT(*) as count FROM users WHERE role IN ('employee', 'manager') GROUP BY department", fetch_all=True)

    total = total_emp["cnt"] if total_emp else 0
    return {
        "total_employees": total,
        "present_today": present["cnt"] if present else 0,
        "absent_today": total - (present["cnt"] if present else 0),
        "pending_leaves": pending["cnt"] if pending else 0,
        "on_break": on_break,
        "department_breakdown": [{"department": d["department"], "count": d["count"]} for d in (dept or [])]
    }


@admin_router.get("/permissions")
async def get_all_permissions(request: Request, status: Optional[str] = None):
    user = await require_permission(request, "permissions", "view", allow_manager=True)
    query = "SELECT * FROM permissions"
    args = []
    conditions = []
    if status:
        conditions.append("status = %s")
        args.append(status)
    if user["role"] in ("manager",):
        conditions.append("user_id IN (SELECT id FROM users WHERE reporting_manager_id = %s)")
        args.append(user["id"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY created_at DESC"
    rows = await execute_query(query, tuple(args) if args else None, fetch_all=True)
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        result.append(d)
    return result

@admin_router.put("/permissions/{permission_id}")
async def review_permission(permission_id: str, request: Request, action: str):
    reviewer = await require_permission(request, "permissions", "edit", allow_manager=True)
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Invalid action")
    perm = await execute_query("SELECT * FROM permissions WHERE id = %s", (int(permission_id),), fetch_one=True)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission request not found")
    if perm["status"] != "pending":
        raise HTTPException(status_code=400, detail="Permission already processed")
    new_status = "approved" if action == "approve" else "rejected"
    await execute_query(
        "UPDATE permissions SET status = %s, reviewed_by = %s, reviewed_at = %s WHERE id = %s",
        (new_status, reviewer["name"], datetime.now(timezone.utc).isoformat(), int(permission_id))
    )

    try:
        html_body = _request_email_html(f"Permission Request {new_status.title()}", perm["user_name"], [
            ("Date", perm["date"]),
            ("Duration", f"{perm['duration_minutes']} minutes"),
            ("Status", f"{new_status.title()} by {reviewer['name']}"),
        ], message="Log in to the HR Portal for details.")
        asyncio.get_event_loop().run_in_executor(None, _send_email, _decision_recipients(perm.get("user_email")), f"Permission {new_status.title()}: {perm['user_name']} ({perm['duration_minutes']} min)", html_body)
    except Exception as e:
        logger.warning(f"Permission decision email dispatch failed: {e}")

    return {"message": f"Permission request {new_status}"}


# Admin Payslip Routes
@admin_router.put("/employees/{employee_id}/salary")
async def set_employee_salary(employee_id: str, salary_data: SalaryUpdate, request: Request):
    await require_permission(request, "payroll", "edit")
    result = await execute_query("UPDATE users SET basic_salary = %s WHERE id = %s", (salary_data.basic_salary, int(employee_id)))
    if result == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Salary updated successfully"}

@admin_router.get("/employees/{employee_id}/salary")
async def get_employee_salary(employee_id: str, request: Request):
    await require_permission(request, "payroll", "view")
    emp = await execute_query("SELECT basic_salary FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"basic_salary": emp.get("basic_salary", 0) or 0}

@admin_router.post("/payslip/generate")
async def generate_payslip(data: PayslipGenerate, request: Request):
    admin = await require_permission(request, "payroll", "edit")
    employee = await execute_query("SELECT * FROM users WHERE id = %s", (int(data.employee_id),), fetch_one=True)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    basic_salary = employee.get("basic_salary", 0) or 0
    if basic_salary <= 0:
        raise HTTPException(status_code=400, detail="Employee salary not set")

    existing = await execute_query("SELECT id FROM payslips WHERE employee_id = %s AND month = %s AND year = %s", (int(data.employee_id), data.month, data.year), fetch_one=True)
    if existing:
        raise HTTPException(status_code=400, detail="Payslip already exists for this month")

    deductions = []
    total_deductions = 0
    month_start = datetime(data.year, data.month, 1, tzinfo=timezone.utc)
    month_end = datetime(data.year + 1, 1, 1, tzinfo=timezone.utc) if data.month == 12 else datetime(data.year, data.month + 1, 1, tzinfo=timezone.utc)
    per_day_salary = basic_salary / WORKING_DAYS_PER_MONTH
    half_day_salary = per_day_salary / 2

    # Half-day deductions
    leave_deds = await execute_query(
        "SELECT amount FROM leave_deductions WHERE user_id = %s AND date >= %s AND date < %s",
        (int(data.employee_id), month_start.isoformat(), month_end.isoformat()), fetch_all=True
    )
    half_day_amount = sum(d.get("amount", 0) for d in (leave_deds or []))
    if half_day_amount > 0:
        amount = half_day_amount * half_day_salary
        deductions.append({"description": f"Half-day deduction ({half_day_amount} days)", "amount": round(amount, 2)})
        total_deductions += amount

    # LOP deductions
    lop_leaves = await execute_query(
        "SELECT days FROM leave_requests WHERE user_id = %s AND status = 'approved' AND leave_type = 'loss_of_pay' AND start_date >= %s AND start_date < %s",
        (int(data.employee_id), month_start.strftime("%Y-%m-%d"), month_end.strftime("%Y-%m-%d")), fetch_all=True
    )
    lop_days = sum(leave.get("days", 0) for leave in (lop_leaves or []))
    if lop_days > 0:
        lop_amount = lop_days * per_day_salary
        deductions.append({"description": f"Loss of Pay ({lop_days} days)", "amount": round(lop_amount, 2)})
        total_deductions += lop_amount

    # Custom deductions (PF, ESI, TDS, etc.)
    custom_deds = await execute_query(
        "SELECT * FROM custom_deductions WHERE user_id = %s AND is_active = 1",
        (int(data.employee_id),), fetch_all=True
    )
    for cd in (custom_deds or []):
        if cd.get("is_percentage") and cd.get("percentage", 0) > 0:
            ded_amount = round(basic_salary * cd["percentage"] / 100, 2)
        else:
            ded_amount = cd.get("amount", 0)
        if ded_amount > 0:
            deductions.append({"description": cd["deduction_name"], "amount": round(ded_amount, 2)})
            total_deductions += ded_amount

    month_names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    net_pay = basic_salary - total_deductions

    payslip_id = await execute_query(
        """INSERT INTO payslips (employee_id, employee_name, employee_email, department, position, month, year, month_name, basic_salary, deduction_details, total_deductions, net_pay, generated_by, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (int(data.employee_id), employee["name"], employee.get("email", ""), employee.get("department", ""), employee.get("position", ""),
         data.month, data.year, month_names[data.month], basic_salary, json.dumps(deductions), round(total_deductions, 2), round(net_pay, 2),
         admin["name"], datetime.now(timezone.utc).isoformat()),
        last_id=True
    )
    email_payslips_in_background([payslip_id])

    return {"id": str(payslip_id), "employee_id": str(data.employee_id), "employee_name": employee["name"], "emailed_to": employee.get("email") or None, "month": data.month, "year": data.year, "month_name": month_names[data.month], "basic_salary": basic_salary, "deduction_details": deductions, "total_deductions": round(total_deductions, 2), "net_pay": round(net_pay, 2), "generated_by": admin["name"], "created_at": datetime.now(timezone.utc).isoformat()}

@admin_router.get("/payslips")
async def get_all_payslips(request: Request, month: Optional[int] = None, year: Optional[int] = None):
    await require_permission(request, "payroll", "view")
    query = "SELECT * FROM payslips"
    conditions = []
    args = []
    if month:
        conditions.append("month = %s")
        args.append(month)
    if year:
        conditions.append("year = %s")
        args.append(year)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY created_at DESC"
    rows = await execute_query(query, tuple(args) if args else None, fetch_all=True)
    result = []
    for ps in (rows or []):
        d = dict(ps)
        d["id"] = str(d.pop("id"))
        d["employee_id"] = str(d["employee_id"])
        if isinstance(d.get("deduction_details"), str):
            d["deduction_details"] = json.loads(d["deduction_details"])
        result.append(d)
    return result

@admin_router.delete("/payslips/{payslip_id}")
async def delete_payslip(payslip_id: str, request: Request):
    await require_permission(request, "payroll", "delete")
    result = await execute_query("DELETE FROM payslips WHERE id = %s", (int(payslip_id),))
    if result == 0:
        raise HTTPException(status_code=404, detail="Payslip not found")
    return {"message": "Payslip deleted"}

@admin_router.post("/payslips/{payslip_id}/email")
async def email_payslip(payslip_id: str, request: Request):
    """Email (or re-send) the payslip PDF to the employee."""
    await require_permission(request, "payroll", "edit")
    try:
        recipient = await send_payslip_email(int(payslip_id))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": f"Payslip emailed to {recipient}"}

@admin_router.get("/salary-components")
async def get_salary_components(request: Request):
    await require_permission(request, "payroll", "view")
    components = await _get_salary_components()
    return [{"id": str(c.get("id", i+1)), "name": c["name"], "percentage": c["percentage"], "is_remainder": bool(c.get("is_remainder", 0)), "sort_order": c.get("sort_order", i+1)} for i, c in enumerate(components)]

@admin_router.put("/salary-components")
async def update_salary_components(request: Request):
    await require_permission(request, "payroll", "edit")
    body = await request.json()
    components = body.get("components", [])
    if not components:
        raise HTTPException(status_code=400, detail="No components provided")
    # Delete all existing and re-insert
    await execute_query("DELETE FROM salary_components")
    for i, comp in enumerate(components):
        await execute_query(
            "INSERT INTO salary_components (name, percentage, is_remainder, sort_order) VALUES (%s, %s, %s, %s)",
            (comp["name"], float(comp.get("percentage", 0)), 1 if comp.get("is_remainder") else 0, i + 1)
        )
    return {"message": "Salary components updated"}


@admin_router.get("/shifts")
async def get_shifts(request: Request):
    await require_any_view(request)
    return {"default_start": DEFAULT_SHIFT_START, "default_end": DEFAULT_SHIFT_END}

@admin_router.put("/employees/{employee_id}/shift")
async def assign_shift(employee_id: str, shift_data: ShiftAssign, request: Request):
    await require_permission(request, "employees", "edit")
    import re
    time_re = re.compile(r"^\d{2}:\d{2}$")
    if not time_re.match(shift_data.start_time) or not time_re.match(shift_data.end_time):
        raise HTTPException(status_code=400, detail="Times must be in HH:MM format")
    employee = await execute_query("SELECT shift FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.get("shift") and employee.get("shift") != "":
        raise HTTPException(status_code=400, detail="Shift already assigned. Use change shift to update.")
    shift_str = f"{shift_data.start_time}-{shift_data.end_time}"
    await execute_query("UPDATE users SET shift = %s WHERE id = %s", (shift_str, int(employee_id)))
    return {"message": f"Shift {shift_data.start_time}–{shift_data.end_time} assigned", "shift": shift_str}

@admin_router.put("/employees/{employee_id}/shift/change")
async def change_shift(employee_id: str, shift_data: ShiftAssign, request: Request):
    await require_permission(request, "employees", "edit")
    import re
    time_re = re.compile(r"^\d{2}:\d{2}$")
    if not time_re.match(shift_data.start_time) or not time_re.match(shift_data.end_time):
        raise HTTPException(status_code=400, detail="Times must be in HH:MM format")
    employee = await execute_query("SELECT id FROM users WHERE id = %s", (int(employee_id),), fetch_one=True)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    shift_str = f"{shift_data.start_time}-{shift_data.end_time}"
    await execute_query("UPDATE users SET shift = %s WHERE id = %s", (shift_str, int(employee_id)))
    return {"message": f"Shift updated to {shift_data.start_time}–{shift_data.end_time}", "shift": shift_str}


# Admin WFH management
@admin_router.get("/wfh-requests")
async def get_all_wfh_requests(request: Request, status: Optional[str] = None):
    user = await require_permission(request, "wfh", "view", allow_manager=True)
    query = "SELECT * FROM wfh_requests"
    args = []
    conditions = []
    if status:
        conditions.append("status = %s")
        args.append(status)
    if user["role"] in ("manager",):
        conditions.append("user_id IN (SELECT id FROM users WHERE reporting_manager_id = %s)")
        args.append(user["id"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY created_at DESC"
    rows = await execute_query(query, tuple(args) if args else None, fetch_all=True)
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        result.append(d)
    return result

@admin_router.put("/wfh-requests/{wfh_id}")
async def review_wfh_request(wfh_id: str, request: Request, action: str):
    reviewer = await require_permission(request, "wfh", "edit", allow_manager=True)
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Invalid action")
    wfh_req = await execute_query("SELECT * FROM wfh_requests WHERE id = %s", (int(wfh_id),), fetch_one=True)
    if not wfh_req:
        raise HTTPException(status_code=404, detail="WFH request not found")
    if wfh_req["status"] != "pending":
        raise HTTPException(status_code=400, detail="WFH request already processed")
    new_status = "approved" if action == "approve" else "rejected"
    await execute_query(
        "UPDATE wfh_requests SET status = %s, reviewed_by = %s, reviewed_at = %s WHERE id = %s",
        (new_status, reviewer["name"], datetime.now(timezone.utc).isoformat(), int(wfh_id))
    )
    return {"message": f"WFH request {new_status}"}


# Custom Deductions CRUD
@admin_router.get("/deductions/{employee_id}")
async def get_employee_deductions(employee_id: str, request: Request):
    await require_permission(request, "payroll", "view", allow_manager=True)
    rows = await execute_query(
        "SELECT * FROM custom_deductions WHERE user_id = %s ORDER BY deduction_name",
        (int(employee_id),), fetch_all=True
    )
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        d["is_percentage"] = bool(d.get("is_percentage", 0))
        d["is_active"] = bool(d.get("is_active", 1))
        result.append(d)
    return result

@admin_router.post("/deductions")
async def add_custom_deduction(data: CustomDeductionCreate, request: Request):
    await require_permission(request, "payroll", "edit")
    ded_id = await execute_query(
        """INSERT INTO custom_deductions (user_id, deduction_name, amount, is_percentage, percentage, is_active, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (data.user_id, data.deduction_name, data.amount, 1 if data.is_percentage else 0,
         data.percentage, 1 if data.is_active else 0, datetime.now(timezone.utc).isoformat()),
        last_id=True
    )
    return {"id": str(ded_id), "user_id": str(data.user_id), "deduction_name": data.deduction_name,
            "amount": data.amount, "is_percentage": data.is_percentage, "percentage": data.percentage, "is_active": data.is_active}

@admin_router.delete("/deductions/{deduction_id}")
async def delete_custom_deduction(deduction_id: str, request: Request):
    await require_permission(request, "payroll", "delete")
    await execute_query("DELETE FROM custom_deductions WHERE id = %s", (int(deduction_id),))
    return {"message": "Deduction deleted"}

@admin_router.put("/deductions/{deduction_id}/toggle")
async def toggle_deduction(deduction_id: str, request: Request):
    await require_permission(request, "payroll", "edit")
    ded = await execute_query("SELECT is_active FROM custom_deductions WHERE id = %s", (int(deduction_id),), fetch_one=True)
    if not ded:
        raise HTTPException(status_code=404, detail="Deduction not found")
    new_status = 0 if ded["is_active"] else 1
    await execute_query("UPDATE custom_deductions SET is_active = %s WHERE id = %s", (new_status, int(deduction_id)))
    return {"is_active": bool(new_status)}


@admin_router.post("/payroll/process")
async def process_bulk_payroll(data: BulkPayrollGenerate, request: Request):
    admin = await require_permission(request, "payroll", "edit")
    return await _run_bulk_payroll(data.month, data.year, admin["name"])

# Also update single payslip generation to include custom deductions
# Payroll Analytics
@admin_router.get("/payroll/summary")
async def payroll_summary(request: Request, year: Optional[int] = None):
    await require_permission(request, "payroll", "view", allow_manager=True)
    if not year:
        year = datetime.now(timezone.utc).year

    # Monthly summary
    monthly = await execute_query(
        "SELECT month, year, SUM(basic_salary) as total_gross, SUM(total_deductions) as total_ded, SUM(net_pay) as total_net, COUNT(*) as emp_count FROM payslips WHERE year = %s GROUP BY month, year ORDER BY month",
        (year,), fetch_all=True
    )

    # Department breakdown
    dept = await execute_query(
        "SELECT department, SUM(basic_salary) as total_gross, SUM(net_pay) as total_net, COUNT(*) as emp_count FROM payslips WHERE year = %s GROUP BY department ORDER BY total_gross DESC",
        (year,), fetch_all=True
    )

    # YTD totals
    ytd = await execute_query(
        "SELECT SUM(basic_salary) as total_gross, SUM(total_deductions) as total_ded, SUM(net_pay) as total_net, COUNT(*) as total_payslips FROM payslips WHERE year = %s",
        (year,), fetch_one=True
    )

    # Payroll runs
    runs = await execute_query(
        "SELECT * FROM payroll_runs WHERE year = %s ORDER BY month DESC",
        (year,), fetch_all=True
    )

    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthly_data = []
    for m in (monthly or []):
        monthly_data.append({
            "month": m["month"], "month_name": month_names[m["month"]], "year": m["year"],
            "total_gross": float(m["total_gross"] or 0), "total_deductions": float(m["total_ded"] or 0),
            "total_net": float(m["total_net"] or 0), "employee_count": m["emp_count"]
        })

    dept_data = []
    for d in (dept or []):
        dept_data.append({
            "department": d["department"] or "Unassigned",
            "total_gross": float(d["total_gross"] or 0), "total_net": float(d["total_net"] or 0),
            "employee_count": d["emp_count"]
        })

    runs_data = []
    for r in (runs or []):
        rd = dict(r)
        rd["id"] = str(rd.pop("id"))
        rd["month_name"] = month_names[rd["month"]]
        runs_data.append(rd)

    return {
        "year": year,
        "monthly": monthly_data,
        "departments": dept_data,
        "ytd": {
            "total_gross": float(ytd["total_gross"] or 0) if ytd else 0,
            "total_deductions": float(ytd["total_ded"] or 0) if ytd else 0,
            "total_net": float(ytd["total_net"] or 0) if ytd else 0,
            "total_payslips": ytd["total_payslips"] if ytd else 0
        },
        "runs": runs_data
    }


# Admin/Manager: list all CRs
@admin_router.get("/change-requests")
async def get_all_crs(request: Request):
    user = await require_permission(request, "change-requests", "view", allow_manager=True)
    if user["role"] == "admin":
        crs = await execute_query("SELECT * FROM change_requests ORDER BY created_at DESC", fetch_all=True)
    else:
        # Managers only see CRs assigned to them via assigned_manager_id
        crs = await execute_query(
            "SELECT * FROM change_requests WHERE assigned_manager_id = %s ORDER BY created_at DESC",
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

# Manager approval (step 1)
@admin_router.put("/change-requests/{cr_id}/manager-action")
async def manager_action_cr(cr_id: str, request: Request, action: str = "approve", notes: str = ""):
    user = await require_permission(request, "change-requests", "edit", allow_manager=True)
    cr = await execute_query("SELECT * FROM change_requests WHERE id = %s", (int(cr_id),), fetch_one=True)
    if not cr:
        raise HTTPException(status_code=404, detail="CR not found")
    if user["role"] != "admin" and cr["assigned_manager_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This change request is not assigned to you")
    if cr["manager_approval"] != "pending":
        raise HTTPException(status_code=400, detail="Manager already acted on this CR")

    now = datetime.now(timezone.utc).isoformat()
    if action == "approve":
        new_status = "manager_approved"
        mgr_approval = "approved"
    else:
        new_status = "rejected"
        mgr_approval = "rejected"

    await execute_query(
        "UPDATE change_requests SET status = %s, manager_approval = %s, manager_id = %s, manager_name = %s, manager_notes = %s, manager_action_at = %s, updated_at = %s WHERE id = %s",
        (new_status, mgr_approval, user["id"], user["name"], notes, now, now, int(cr_id))
    )

    # Notify admins for final approval — notify-only email, portal login required
    if action == "approve":
        try:
            cr_updated = await execute_query("SELECT * FROM change_requests WHERE id = %s", (int(cr_id),), fetch_one=True)
            admins = await execute_query("SELECT email FROM users WHERE role = 'admin'", fetch_all=True)
            for adm in (admins or []):
                html_body = _cr_email_html(cr_updated, "Admin")
                subj = f"[{cr_updated.get('cr_number','CR')}] Manager Approved — Final Approval Needed: {cr_updated.get('title','')}"
                asyncio.get_event_loop().run_in_executor(None, _send_email, [adm["email"]], subj, html_body)
        except Exception as ex:
            logger.warning(f"Admin email after manager-approve failed: {ex}")

    return {"message": f"CR {action}d by manager", "status": new_status}

# Admin approval (step 2) with auto-apply
@admin_router.put("/change-requests/{cr_id}/admin-action")
async def admin_action_cr(cr_id: str, request: Request):
    admin = await require_permission(request, "change-requests", "edit")
    body = await request.json()
    action = body.get("action", "approve")
    notes = body.get("notes", "")
    apply_value = body.get("apply_value", "")

    cr = await execute_query("SELECT * FROM change_requests WHERE id = %s", (int(cr_id),), fetch_one=True)
    if not cr:
        raise HTTPException(status_code=404, detail="CR not found")
    if cr["admin_approval"] != "pending":
        raise HTTPException(status_code=400, detail="Admin already acted on this CR")

    now = datetime.now(timezone.utc).isoformat()
    if action == "approve":
        new_status = "approved"
        adm_approval = "approved"
    else:
        new_status = "rejected"
        adm_approval = "rejected"

    applied_changes = None
    # Auto-apply changes on approval
    if action == "approve" and apply_value:
        cr_type = cr.get("cr_type", "")
        requester_id = cr.get("requester_id")
        try:
            if cr_type == "Salary Revision":
                new_salary = float(apply_value)
                await execute_query("UPDATE users SET basic_salary = %s WHERE id = %s", (new_salary, requester_id))
                applied_changes = json.dumps({"type": "salary_revision", "new_value": new_salary})
            elif cr_type == "Leave Adjustment":
                new_leave = float(apply_value)
                await execute_query("UPDATE users SET casual_leave = %s WHERE id = %s", (new_leave, requester_id))
                applied_changes = json.dumps({"type": "leave_adjustment", "casual_leave": new_leave})
            elif cr_type == "Shift Change":
                new_shift = str(apply_value).strip()
                await execute_query("UPDATE users SET shift = %s WHERE id = %s", (new_shift, requester_id))
                applied_changes = json.dumps({"type": "shift_change", "new_shift": new_shift})
        except Exception as e:
            logger.warning(f"Auto-apply failed for CR {cr_id}: {e}")

    await execute_query(
        "UPDATE change_requests SET status = %s, admin_approval = %s, admin_id = %s, admin_name = %s, admin_notes = %s, admin_action_at = %s, applied_changes = %s, updated_at = %s WHERE id = %s",
        (new_status, adm_approval, admin["id"], admin["name"], notes, now, applied_changes, now, int(cr_id))
    )
    return {"message": f"CR {action}d by admin", "status": new_status, "applied": applied_changes is not None}


# Notification counts for manager/admin
@admin_router.get("/notifications")
async def get_notifications(request: Request):
    user = await require_any_view(request, allow_manager=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pending_leaves = await execute_query("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'", fetch_one=True)
    pending_wfh = await execute_query("SELECT COUNT(*) as cnt FROM wfh_requests WHERE status = 'pending'", fetch_one=True)
    pending_permissions = await execute_query("SELECT COUNT(*) as cnt FROM permissions WHERE status = 'pending'", fetch_one=True)
    if user["role"] == "admin":
        pending_crs = await execute_query("SELECT COUNT(*) as cnt FROM change_requests WHERE status IN ('pending', 'manager_approved')", fetch_one=True)
        emergency_clockouts = await execute_query("SELECT COUNT(*) as cnt FROM attendance WHERE is_emergency_clockout = 1 AND date = %s", (today,), fetch_one=True)
    else:
        # Managers only see CRs assigned to them that are still pending their action
        pending_crs = await execute_query(
            "SELECT COUNT(*) as cnt FROM change_requests WHERE assigned_manager_id = %s AND manager_approval = 'pending'",
            (user["id"],), fetch_one=True
        )
        emergency_clockouts = await execute_query(
            "SELECT COUNT(*) as cnt FROM attendance a JOIN users u ON a.user_id = u.id WHERE a.is_emergency_clockout = 1 AND a.date = %s AND u.reporting_manager_id = %s",
            (today, user["id"]), fetch_one=True
        )

    total = (pending_leaves["cnt"] or 0) + (pending_wfh["cnt"] or 0) + (pending_crs["cnt"] or 0) + (pending_permissions["cnt"] or 0) + (emergency_clockouts["cnt"] or 0)
    items = []
    if pending_leaves["cnt"]: items.append({"type": "leave", "count": pending_leaves["cnt"], "label": f"{pending_leaves['cnt']} pending leave request(s)"})
    if pending_wfh["cnt"]: items.append({"type": "wfh", "count": pending_wfh["cnt"], "label": f"{pending_wfh['cnt']} pending WFH request(s)"})
    if pending_crs["cnt"]: items.append({"type": "cr", "count": pending_crs["cnt"], "label": f"{pending_crs['cnt']} pending change request(s)"})
    if pending_permissions["cnt"]: items.append({"type": "permission", "count": pending_permissions["cnt"], "label": f"{pending_permissions['cnt']} pending permission request(s)"})
    if emergency_clockouts["cnt"]: items.append({"type": "emergency", "count": emergency_clockouts["cnt"], "label": f"{emergency_clockouts['cnt']} emergency clock-out(s) today"})
    return {"total": total, "items": items}

# Attendance heatmap — weekly on-time/late/absent
@admin_router.get("/attendance/heatmap")
async def get_attendance_heatmap(request: Request, weeks: int = 4):
    await require_permission(request, "attendance", "view", allow_manager=True)
    today = datetime.now(timezone.utc)
    start = today - timedelta(days=weeks * 7)
    start_str = start.strftime("%Y-%m-%d")
    end_str = today.strftime("%Y-%m-%d")

    # Get all employees
    emps = await execute_query("SELECT id, name, employee_code, department FROM users WHERE role IN ('employee', 'manager') ORDER BY name", fetch_all=True)
    # Get attendance records in range
    records = await execute_query(
        "SELECT user_id, date, clock_in, working_hours, is_short_day FROM attendance WHERE date >= %s AND date <= %s",
        (start_str, end_str), fetch_all=True
    )

    # Build lookup: {user_id: {date: record}}
    att_map = {}
    for r in (records or []):
        uid = r["user_id"]
        if uid not in att_map:
            att_map[uid] = {}
        att_map[uid][r["date"]] = r

    # Generate date list (excluding weekends)
    dates = []
    d = start
    while d <= today:
        ds = d.strftime("%Y-%m-%d")
        if d.weekday() < 5:  # Mon-Fri
            dates.append(ds)
        d += timedelta(days=1)

    # Build heatmap data
    heatmap = []
    for emp in (emps or []):
        row = {"employee_id": str(emp["id"]), "name": emp["name"], "employee_code": emp.get("employee_code", ""), "department": emp.get("department", ""), "days": []}
        for dt in dates:
            rec = att_map.get(emp["id"], {}).get(dt)
            if rec:
                # Check if on-time: clock_in before 10:00 AM office time is on-time
                try:
                    cin = datetime.fromisoformat(rec["clock_in"])
                    if cin.tzinfo is None:
                        cin = cin.replace(tzinfo=timezone.utc)
                    cin = cin.astimezone(APP_TIMEZONE)
                    clock_hour = cin.hour + cin.minute / 60
                    if clock_hour <= 10.0:
                        status = "ontime"
                    else:
                        status = "late"
                except Exception:
                    status = "present"
                if rec.get("is_short_day"):
                    status = "short"
                row["days"].append({"date": dt, "status": status, "hours": rec.get("working_hours")})
            else:
                row["days"].append({"date": dt, "status": "absent", "hours": None})
        heatmap.append(row)

    return {"dates": dates, "employees": heatmap}

# Break location alerts — breaks outside office geofence

@admin_router.get("/office-settings")
async def get_office_settings_api(request: Request):
    await require_permission(request, "attendance", "view")
    settings = await get_office_settings()
    return settings

@admin_router.put("/office-settings")
async def update_office_settings_api(data: OfficeSettingsUpdate, request: Request):
    await require_permission(request, "attendance", "edit")
    now = datetime.now(timezone.utc).isoformat()
    try:
        existing = await execute_query("SELECT id FROM office_settings WHERE id = 1", fetch_one=True)
        if existing:
            await execute_query(
                "UPDATE office_settings SET latitude=%s, longitude=%s, radius_km=%s, office_name=%s, address=%s, geofence_bypass=%s, updated_at=%s WHERE id=1",
                (data.latitude, data.longitude, data.radius_km, data.office_name, data.address[:500] if data.address else "", int(data.geofence_bypass), now)
            )
        else:
            await execute_query(
                "INSERT INTO office_settings (id, latitude, longitude, radius_km, office_name, address, geofence_bypass, updated_at) VALUES (1,%s,%s,%s,%s,%s,%s,%s)",
                (data.latitude, data.longitude, data.radius_km, data.office_name, data.address[:500] if data.address else "", int(data.geofence_bypass), now)
            )
    except Exception as e:
        logger.error(f"Office settings update error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    return {"message": "Office settings updated", "latitude": data.latitude, "longitude": data.longitude, "radius_km": data.radius_km, "geofence_bypass": data.geofence_bypass}

# Employee location map data for admin
@admin_router.get("/attendance/locations")
async def get_attendance_locations(request: Request, date: str = None):
    await require_permission(request, "attendance", "view", allow_manager=True)
    if not date:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    records = await execute_query(
        """SELECT a.*, u.employee_code, u.department, u.position, u.avatar_url
           FROM attendance a JOIN users u ON a.user_id = u.id
           WHERE a.date = %s AND a.clock_in_lat IS NOT NULL
           ORDER BY a.clock_in DESC""",
        (date,), fetch_all=True
    )
    result = []
    for r in (records or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        d["user_id"] = str(d["user_id"])
        result.append(d)
    return result


@admin_router.post("/reset-portal")
async def reset_portal(body: ResetPortalRequest, request: Request):
    """Deletes ALL data except the superadmin user and Worker Tree. Requires admin password."""
    user = await require_admin(request)
    admin_id = user.get("id")

    # Verify password before proceeding
    db_user = await execute_query("SELECT password_hash FROM users WHERE id = %s", (int(admin_id),), fetch_one=True)
    if not db_user or not verify_password(body.password, db_user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect password. Reset cancelled.")

    tables_to_clear = [
        "attendance", "breaks", "leave_requests", "wfh_requests",
        "permissions", "payslips", "leave_deductions", "custom_deductions",
        "payroll_runs", "change_requests", "media",
    ]
    for table in tables_to_clear:
        try:
            await execute_query(f"DELETE FROM `{table}`", ())
        except Exception as e:
            logging.warning(f"Reset: could not clear {table}: {e}")

    try:
        await execute_query(
            "DELETE FROM users WHERE id != %s AND email NOT IN ('ponish.jino@sparkcurv.com', 'hr@sparkcurv.com')",
            (int(admin_id),)
        )
    except Exception as e:
        logging.warning(f"Reset: could not clear users: {e}")

    logging.info(f"Portal reset by admin id={admin_id}")
    return {"message": "Portal reset complete. All employee data cleared. Worker Tree and your account are preserved."}
