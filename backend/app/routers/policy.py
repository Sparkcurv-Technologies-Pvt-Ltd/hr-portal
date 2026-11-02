"""Company policy routes (``/api/policy``)."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.permissions import require_permission
from app.core.security import get_current_user
from app.db import execute_query
from app.schemas.policy import PolicyCreate, PolicyUpdate


policy_router = APIRouter(prefix="/policy")


@policy_router.get("/list")
async def get_policies(request: Request):
    """Get all company policies - accessible to all authenticated users"""
    await get_current_user(request)
    rows = await execute_query("SELECT * FROM policies ORDER BY sort_order ASC, id ASC", fetch_all=True)
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d.pop("id"))
        result.append(d)
    return result

@policy_router.post("/create")
async def create_policy(data: PolicyCreate, request: Request):
    await require_permission(request, "policy", "edit")
    pid = await execute_query(
        "INSERT INTO policies (title, category, content, icon, sort_order, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (data.title, data.category, data.content, data.icon, data.sort_order, datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()),
        last_id=True
    )
    return {"id": str(pid), "title": data.title, "category": data.category, "content": data.content, "icon": data.icon, "sort_order": data.sort_order}

@policy_router.put("/{policy_id}")
async def update_policy(policy_id: str, data: PolicyUpdate, request: Request):
    await require_permission(request, "policy", "edit")
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_dict:
        raise HTTPException(status_code=400, detail="No update data")
    update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join([f"{k} = %s" for k in update_dict])
    values = list(update_dict.values()) + [int(policy_id)]
    result = await execute_query(f"UPDATE policies SET {set_clause} WHERE id = %s", tuple(values))
    if result == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy updated"}

@policy_router.delete("/{policy_id}")
async def delete_policy(policy_id: str, request: Request):
    await require_permission(request, "policy", "delete")
    result = await execute_query("DELETE FROM policies WHERE id = %s", (int(policy_id),))
    if result == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy deleted"}
