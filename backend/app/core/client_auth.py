"""Client-portal authentication, kept apart from staff auth.

Clients live in ``client_contacts`` (not ``users``), sign in with their own ``client_token`` cookie and their JWT has
``type: "client"`` — so a client token is rejected by the staff dependency (which requires ``type: "access"``) and a
staff token is rejected here.
"""

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, Request

from app.core.config import JWT_ALGORITHM
from app.core.security import get_jwt_secret
from app.db import execute_query

CLIENT_COOKIE = "client_token"
CLIENT_TOKEN_HOURS = 12


def create_client_token(contact_id: int) -> str:
    payload = {"sub": str(contact_id), "type": "client", "exp": datetime.now(timezone.utc) + timedelta(hours=CLIENT_TOKEN_HOURS)}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


async def get_current_client(request: Request) -> dict:
    """The signed-in client contact (with its company), or 401. Disabled contacts / companies are refused."""
    token = request.cookies.get(CLIENT_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "client":
        raise HTTPException(status_code=401, detail="Invalid token type")
    contact = await execute_query(
        """SELECT c.id, c.client_id, c.name, c.email, c.phone, cl.name AS client_name
           FROM client_contacts c JOIN clients cl ON cl.id = c.client_id
           WHERE c.id = %s AND c.active = 1 AND cl.status = 'active'""",
        (int(payload["sub"]),), fetch_one=True
    )
    if not contact:
        raise HTTPException(status_code=401, detail="Account disabled")
    return contact
