"""Per-employee module permissions (View / Edit / Delete), granted by admins.

Admins always have full access. Managers get what an admin stores for them in
``user_permissions``. Employees (role "employee") never get management access, whatever
is stored for them. Module keys match the admin panel tabs and
``frontend/src/lib/permissions.js``.
"""

from fastapi import HTTPException, Request

from app.core.security import get_current_user
from app.db import execute_query


MODULES = [
    "employees", "payroll", "finance", "leaves", "wfh", "permissions",
    "change-requests", "attendance", "org-chart", "policy", "holidays",
]
ACTIONS = ("view", "edit", "delete")


async def get_module_permissions(user_id: int) -> dict:
    """``{module: {"view": bool, "edit": bool, "delete": bool}}`` for one user (only modules with a row)."""
    rows = await execute_query(
        "SELECT module, can_view, can_edit, can_delete FROM user_permissions WHERE user_id = %s",
        (int(user_id),), fetch_all=True
    )
    return {
        r["module"]: {"view": bool(r["can_view"]), "edit": bool(r["can_edit"]), "delete": bool(r["can_delete"])}
        for r in (rows or [])
    }


# Roles that can be granted management-panel modules (admins already have everything)
GRANTABLE_ROLES = ("manager",)


async def effective_module_permissions(user: dict) -> dict:
    """Grants that actually apply to this user: none for employees."""
    if user.get("role") not in GRANTABLE_ROLES:
        return {}
    return await get_module_permissions(user["id"])


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
    if any(has_permission(perms, m, "view") for m in MODULES):
        return _granted_scope(user)
    if allow_manager and user.get("role") == "manager":
        return user
    raise HTTPException(status_code=403, detail="Access denied")
