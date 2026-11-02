"""Password hashing, JWT creation/validation and auth/role dependencies."""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request

from app.core.config import JWT_ALGORITHM
from app.db import execute_query


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]

# Password utilities
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

# JWT utilities
def create_access_token(user_id: int, email: str, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
        "type": "access"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

# Auth dependency
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await execute_query(
            "SELECT id, email, name, role, department, position, avatar_url, casual_leave, sick_leave, loss_of_pay, permission_hours, half_day_leave, shift, basic_salary, employee_code, gps_tracking_enabled, timer_access_enabled, full_day_required, vault_editor, reporting_manager_id FROM users WHERE id = %s",
            (int(payload["sub"]),), fetch_one=True
        )
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["id"])
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

async def require_admin_or_manager(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin or Manager access required")
    return user
