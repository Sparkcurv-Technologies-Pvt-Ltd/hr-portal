"""Authentication routes (``/api/auth``)."""

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.config import COOKIE_SAMESITE, COOKIE_SECURE
from app.core.permissions import effective_module_permissions
from app.core.security import create_access_token, create_refresh_token, get_current_user, is_superadmin, verify_password
from app.db import execute_query
from app.schemas.auth import UserLogin


auth_router = APIRouter(prefix="/auth")


async def _has_vault_access(user: dict) -> bool:
    """Admins and vault editors always; others when at least one vault credential is shared with them."""
    if user.get("role") == "admin" or user.get("vault_editor"):
        return True
    row = await execute_query("SELECT 1 AS ok FROM vault_shares WHERE user_id = %s LIMIT 1", (user["id"],), fetch_one=True)
    return bool(row)


@auth_router.post("/login")
async def login(user_data: UserLogin, response: Response):
    email = user_data.email.lower()
    user = await execute_query("SELECT * FROM users WHERE email = %s", (email,), fetch_one=True)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(user["id"], email, user["role"])
    refresh_token = create_refresh_token(user["id"])
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=604800, path="/")

    return {"id": str(user["id"]), "email": email, "name": user["name"], "role": user["role"], "department": user.get("department", "General"), "position": user.get("position", "Employee"), "avatar_url": user.get("avatar_url"), "employee_code": user.get("employee_code", ""), "gps_tracking_enabled": bool(int(user["gps_tracking_enabled"]) if user.get("gps_tracking_enabled") is not None else 1), "timer_access_enabled": bool(int(user["timer_access_enabled"]) if user.get("timer_access_enabled") is not None else 0), "module_permissions": await effective_module_permissions(user), "vault_access": await _has_vault_access(user), "vault_editor": bool(user.get("vault_editor")), "is_superadmin": is_superadmin(user)}

@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")
    return {"message": "Logged out successfully"}

@auth_router.get("/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    user.pop("password_hash", None)
    user.pop("basic_salary", None)
    user["gps_tracking_enabled"] = bool(int(user["gps_tracking_enabled"]) if user.get("gps_tracking_enabled") is not None else 1)
    user["timer_access_enabled"] = bool(int(user["timer_access_enabled"]) if user.get("timer_access_enabled") is not None else 0)
    user["module_permissions"] = await effective_module_permissions(user)
    user["vault_access"] = await _has_vault_access(user)
    user["vault_editor"] = bool(user.get("vault_editor"))
    user["is_superadmin"] = is_superadmin(user)
    return user

@auth_router.get("/password-reset-info")
async def password_reset_info():
    return {"message": "To reset your password, please contact HR department.", "contact_email": "hr@company.com", "contact_method": "Email HR or visit HR office during working hours"}
