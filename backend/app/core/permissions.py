"""Per-employee module permissions (View / Edit / Delete), granted by admins.

Admins always have full access. Managers get only what an admin has explicitly saved for
them in ``user_permissions`` (nothing by default). Employees get management access only
from grants made by a superadmin (SUPERADMIN_EMAILS); anything else stored for them is ignored. Module keys match the admin panel tabs and
``frontend/src/lib/permissions.js``.
"""

from fastapi import HTTPException, Request

from app.core.config import SUPERADMIN_EMAILS
from app.core.security import get_current_user, is_superadmin
from app.db import execute_query


MODULES = [
    "employees", "payroll", "finance", "leaves", "wfh", "permissions",
    "change-requests", "attendance", "org-chart", "policy", "holidays", "projects", "tickets", "monitoring", "ssh",
]
# Modules with their own page outside the Management panel: a grant on them doesn't open employee data or the panel
OWN_PAGE_MODULES = ("projects", "tickets", "monitoring", "ssh")
ACTIONS = ("view", "edit", "delete")


async def superadmin_ids() -> list:
    rows = await execute_query("SELECT id, email FROM users WHERE role = 'admin'", fetch_all=True)
    return [r["id"] for r in (rows or []) if (r["email"] or "").lower() in SUPERADMIN_EMAILS]


async def get_module_permissions(user_id: int, granted_by_in: list = None) -> dict:
    """``{module: {"view": bool, "edit": bool, "delete": bool}}`` for one user (only modules with a row).
    ``granted_by_in`` limits it to grants made by those users."""
    if granted_by_in is not None and not granted_by_in:
        return {}
    query = "SELECT module, can_view, can_edit, can_delete FROM user_permissions WHERE user_id = %s"
    args = [int(user_id)]
    if granted_by_in is not None:
        query += f" AND granted_by IN ({', '.join(['%s'] * len(granted_by_in))})"
        args += list(granted_by_in)
    rows = await execute_query(query, tuple(args), fetch_all=True)
    return {
        r["module"]: {"view": bool(r["can_view"]), "edit": bool(r["can_edit"]), "delete": bool(r["can_delete"])}
        for r in (rows or [])
    }


# Roles that can be granted management-panel modules (admins already have everything)
GRANTABLE_ROLES = ("manager", "employee")


def can_grant(granter: dict, target_role: str) -> bool:
    """Any admin can grant managers; only a superadmin can grant employees."""
    if target_role == "manager":
        return granter.get("role") == "admin"
    if target_role == "employee":
        return is_superadmin(granter)
    return False


async def effective_module_permissions(user: dict) -> dict:
    """Grants that apply to this user: managers' as saved; employees' only if a superadmin granted them."""
    role = user.get("role")
    if role == "manager":
        return await get_module_permissions(user["id"])
    if role == "employee":
        return await get_module_permissions(user["id"], granted_by_in=await superadmin_ids())
    return {}


def has_permission(perms: dict, module: str, action: str) -> bool:
    """Edit or delete implies view."""
    p = perms.get(module)
    if not p:
        return False
    if action == "view":
        return p["view"] or p["edit"] or p["delete"]
    return p[action]


def _granted_scope(user: dict) -> dict:
    # Granted users act company-wide (like an admin) for this request, so handlers that
    # narrow managers to their direct reports don't apply that filter to them.
    # `_granted` lets sensitive handlers still refuse admin-only operations (e.g. promoting to admin).
    return {**user, "role": "admin", "_granted": True}


def forbid_granted_on_admin(user: dict, target: dict = None, new_role: str = None) -> None:
    """Granted (non-admin) users may not touch admin accounts or hand out the admin role."""
    if not user.get("_granted"):
        return
    if (target and target.get("role") == "admin") or new_role == "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage admin accounts")


async def require_permission(request: Request, module: str, action: str = "view", allow_manager: bool = False) -> dict:
    """Admin, or a user granted ``action`` on ``module``.

    ``allow_manager`` keeps the existing team-scoped access managers had to this endpoint.
    """
    user = await get_current_user(request)
    if user.get("role") == "admin":
        return user
    if has_permission(await effective_module_permissions(user), module, action):
        return _granted_scope(user)
    if allow_manager and user.get("role") == "manager":
        return user
    raise HTTPException(status_code=403, detail=f"You don't have {action} access to {module}")


async def require_any_view(request: Request, allow_manager: bool = False) -> dict:
    """Admin, or a user with view access to at least one module (shared lookups like the employee list)."""
    user = await get_current_user(request)
    if user.get("role") == "admin":
        return user
    perms = await effective_module_permissions(user)
    if any(has_permission(perms, m, "view") for m in MODULES if m not in OWN_PAGE_MODULES):
        return _granted_scope(user)
    if allow_manager and user.get("role") == "manager":
        return user
    raise HTTPException(status_code=403, detail="Access denied")
