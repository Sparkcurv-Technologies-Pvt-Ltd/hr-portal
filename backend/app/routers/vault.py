"""Credential vault (``/api/vault``): encrypted shared passwords.

- Admins see and manage every credential (create, edit, share, delete), choose vault editors,
  and see the activity log.
- Vault editors (chosen by an admin) can add credentials and fully manage the ones they created
  (edit, share, delete). They only see other credentials when those are shared with them.
- Other employees see only credentials shared with them; a share is "view" (reveal/copy) or
  "edit" (also update the credential).
- Secrets and notes are encrypted at rest (see app.core.vault_crypto) and only returned by the
  reveal endpoint, which is logged. Nothing here ever logs a secret.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.security import get_current_user, require_admin
from app.core.vault_crypto import decrypt, encrypt
from app.db import execute_query
from app.schemas.vault import VaultEditorsUpdate, VaultItemCreate, VaultItemUpdate, VaultSharesUpdate


vault_router = APIRouter(prefix="/vault")

NO_STORE = {"Cache-Control": "no-store, max-age=0", "Pragma": "no-cache"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _clean(value: Optional[str], limit: int) -> str:
    return (value or "").strip()[:limit]

async def _audit(item_id: Optional[int], item_title: str, user: dict, action: str, request: Request, detail: str = "") -> None:
    await execute_query(
        "INSERT INTO vault_audit (item_id, item_title, user_id, user_name, action, detail, ip, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (item_id, item_title[:200], user["id"], user.get("name", ""), action, detail[:300], request.client.host if request.client else "", _now())
    )

def _is_editor(user: dict) -> bool:
    return bool(user.get("vault_editor"))

async def _require_manager(request: Request) -> dict:
    """Admin or vault editor (can add credentials)."""
    user = await get_current_user(request)
    if user.get("role") != "admin" and not _is_editor(user):
        raise HTTPException(status_code=403, detail="Only admins and vault editors can add credentials")
    return user

async def _access(item_id: int, user: dict, item: Optional[dict] = None) -> Optional[str]:
    """'admin', 'owner' (vault editor who created it), 'edit', 'view' or None (no access)."""
    if user.get("role") == "admin":
        return "admin"
    if _is_editor(user):
        owner = item if item is not None else await execute_query("SELECT owner_id FROM vault_items WHERE id = %s", (item_id,), fetch_one=True)
        if owner and owner.get("owner_id") == user["id"]:
            return "owner"
    share = await execute_query("SELECT can_edit FROM vault_shares WHERE item_id = %s AND user_id = %s", (item_id, user["id"]), fetch_one=True)
    if not share:
        return None
    return "edit" if share["can_edit"] else "view"

async def _get_item_or_404(item_id: int) -> dict:
    item = await execute_query("SELECT * FROM vault_items WHERE id = %s", (item_id,), fetch_one=True)
    if not item:
        raise HTTPException(status_code=404, detail="Credential not found")
    return item

async def _require_access(item_id: int, user: dict, need: str = "view") -> tuple:
    """need = 'view' | 'edit' | 'manage' (share/delete: admin or owning editor)."""
    item = await _get_item_or_404(item_id)
    access = await _access(item_id, user, item)
    if access is None:
        # Same answer as "doesn't exist" so employees can't probe for credentials they don't have
        raise HTTPException(status_code=404, detail="Credential not found")
    if need == "edit" and access == "view":
        raise HTTPException(status_code=403, detail="You have view-only access to this credential")
    if need == "manage" and access not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Only admins and the editor who added this credential can share or delete it")
    return item, access

async def _replace_shares(item_id: int, shares: list, exclude_user_id: Optional[int] = None) -> list:
    """Replace an item's shares; only existing non-admin users are kept (and never the owning
    editor, who already manages it). Returns names for the log."""
    await execute_query("DELETE FROM vault_shares WHERE item_id = %s", (item_id,))
    names = []
    seen = set()
    for s in shares:
        try:
            uid = int(s.user_id)
        except (TypeError, ValueError):
            continue
        if uid in seen or uid == exclude_user_id:
            continue
        target = await execute_query("SELECT id, name, role FROM users WHERE id = %s", (uid,), fetch_one=True)
        if not target or target["role"] == "admin":
            continue  # admins always have full access
        seen.add(uid)
        await execute_query(
            "INSERT INTO vault_shares (item_id, user_id, can_edit, created_at) VALUES (%s, %s, %s, %s)",
            (item_id, uid, int(bool(s.can_edit)), _now())
        )
        names.append(f"{target['name']} ({'edit' if s.can_edit else 'view'})")
    return names


@vault_router.get("/items")
async def list_items(request: Request, response: Response):
    """Credentials the caller can see — without secrets."""
    user = await get_current_user(request)
    response.headers.update(NO_STORE)
    if user.get("role") == "admin":
        items = await execute_query("SELECT * FROM vault_items ORDER BY title", fetch_all=True)
        access = {i["id"]: "admin" for i in (items or [])}
    else:
        owner_id = user["id"] if _is_editor(user) else -1
        items = await execute_query(
            """SELECT v.*, s.can_edit FROM vault_items v
               LEFT JOIN vault_shares s ON s.item_id = v.id AND s.user_id = %s
               WHERE v.owner_id = %s OR s.user_id IS NOT NULL ORDER BY v.title""",
            (user["id"], owner_id), fetch_all=True
        )
        access = {i["id"]: ("owner" if i.get("owner_id") == owner_id else "edit" if i["can_edit"] else "view") for i in (items or [])}

    # Sharing details only for the credentials the caller manages
    managed_ids = [i for i, a in access.items() if a in ("admin", "owner")]
    shares_by_item = {}
    if managed_ids:
        placeholders = ", ".join(["%s"] * len(managed_ids))
        rows = await execute_query(
            f"SELECT s.item_id, s.user_id, s.can_edit, u.name FROM vault_shares s JOIN users u ON u.id = s.user_id WHERE s.item_id IN ({placeholders}) ORDER BY u.name",
            tuple(managed_ids), fetch_all=True
        )
        for r in (rows or []):
            shares_by_item.setdefault(r["item_id"], []).append({"user_id": str(r["user_id"]), "name": r["name"], "can_edit": bool(r["can_edit"])})

    return [{
        "id": str(i["id"]), "title": i["title"], "category": i["category"], "username": i["username"], "url": i["url"],
        "has_notes": bool(i["notes_enc"]), "updated_at": i["updated_at"], "updated_by": i["updated_by"],
        "access": access[i["id"]], "created_by": i["created_by"],
        **({"shared_with": shares_by_item.get(i["id"], [])} if access[i["id"]] in ("admin", "owner") else {}),
    } for i in (items or [])]

@vault_router.post("/items")
async def create_item(data: VaultItemCreate, request: Request):
    admin = await _require_manager(request)
    title = _clean(data.title, 200)
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if not data.secret:
        raise HTTPException(status_code=400, detail="Password / secret is required")
    now = _now()
    item_id = await execute_query(
        """INSERT INTO vault_items (title, category, username, url, secret_enc, notes_enc, owner_id, created_by, updated_by, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (title, _clean(data.category, 60) or "General", _clean(data.username, 255), _clean(data.url, 500),
         encrypt(data.secret), encrypt(data.notes) if data.notes else "", admin["id"], admin["name"], admin["name"], now, now),
        last_id=True
    )
    names = await _replace_shares(item_id, data.shares, exclude_user_id=admin["id"])
    await _audit(item_id, title, admin, "create", request, f"shared with: {', '.join(names) or 'nobody'}")
    return {"id": str(item_id), "message": "Credential saved"}

@vault_router.put("/items/{item_id}")
async def update_item(item_id: str, data: VaultItemUpdate, request: Request):
    user = await get_current_user(request)
    item, _ = await _require_access(int(item_id), user, need="edit")
    fields, values, changed = [], [], []
    for name, limit in (("title", 200), ("category", 60), ("username", 255), ("url", 500)):
        value = getattr(data, name)
        if value is not None:
            if name == "title" and not value.strip():
                raise HTTPException(status_code=400, detail="Title is required")
            fields.append(f"{name} = %s"); values.append(_clean(value, limit)); changed.append(name)
    if data.secret is not None:
        if not data.secret:
            raise HTTPException(status_code=400, detail="Password / secret can't be empty")
        fields.append("secret_enc = %s"); values.append(encrypt(data.secret)); changed.append("password")
    if data.notes is not None:
        fields.append("notes_enc = %s"); values.append(encrypt(data.notes) if data.notes else ""); changed.append("notes")
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")
    fields += ["updated_by = %s", "updated_at = %s"]; values += [user["name"], _now()]
    await execute_query(f"UPDATE vault_items SET {', '.join(fields)} WHERE id = %s", (*values, int(item_id)))
    await _audit(int(item_id), data.title or item["title"], user, "update", request, f"changed: {', '.join(changed)}")
    return {"message": "Credential updated"}

@vault_router.put("/items/{item_id}/shares")
async def update_shares(item_id: str, data: VaultSharesUpdate, request: Request):
    admin = await get_current_user(request)
    item, _ = await _require_access(int(item_id), admin, need="manage")
    names = await _replace_shares(int(item_id), data.shares, exclude_user_id=item.get("owner_id"))
    await _audit(int(item_id), item["title"], admin, "share", request, f"shared with: {', '.join(names) or 'nobody'}")
    return {"message": "Sharing updated"}

@vault_router.delete("/items/{item_id}")
async def delete_item(item_id: str, request: Request):
    admin = await get_current_user(request)
    item, _ = await _require_access(int(item_id), admin, need="manage")
    await execute_query("DELETE FROM vault_shares WHERE item_id = %s", (int(item_id),))
    await execute_query("DELETE FROM vault_items WHERE id = %s", (int(item_id),))
    await _audit(int(item_id), item["title"], admin, "delete", request)
    return {"message": "Credential deleted"}

@vault_router.post("/items/{item_id}/reveal")
async def reveal_item(item_id: str, request: Request, response: Response, purpose: str = "reveal"):
    """Return the decrypted password + notes. Logged as 'reveal' or 'copy'."""
    user = await get_current_user(request)
    item, _ = await _require_access(int(item_id), user)
    response.headers.update(NO_STORE)
    action = "copy" if purpose == "copy" else "reveal"
    await _audit(int(item_id), item["title"], user, action, request)
    return {"secret": decrypt(item["secret_enc"]), "notes": decrypt(item["notes_enc"]) if item["notes_enc"] else ""}

@vault_router.get("/audit")
async def get_audit(request: Request, response: Response, item_id: Optional[str] = None, limit: int = 200):
    await require_admin(request)
    response.headers.update(NO_STORE)
    limit = max(1, min(int(limit), 1000))
    if item_id:
        rows = await execute_query("SELECT * FROM vault_audit WHERE item_id = %s ORDER BY id DESC LIMIT %s", (int(item_id), limit), fetch_all=True)
    else:
        rows = await execute_query("SELECT * FROM vault_audit ORDER BY id DESC LIMIT %s", (limit,), fetch_all=True)
    return [{
        "id": str(r["id"]), "item_id": str(r["item_id"]) if r["item_id"] else None, "item_title": r["item_title"],
        "user_name": r["user_name"], "action": r["action"], "detail": r["detail"], "ip": r["ip"], "created_at": r["created_at"],
    } for r in (rows or [])]


@vault_router.get("/people")
async def list_people(request: Request):
    """Employees that credentials can be shared with (for the sharing picker of admins and editors)."""
    user = await _require_manager(request)
    rows = await execute_query(
        "SELECT id, name, department, email, avatar_url, vault_editor FROM users WHERE role != 'admin' ORDER BY name",
        fetch_all=True
    )
    is_admin = user.get("role") == "admin"
    return [{
        "id": str(r["id"]), "name": r["name"], "department": r["department"] or "", "avatar_url": r["avatar_url"],
        **({"email": r["email"], "vault_editor": bool(r["vault_editor"])} if is_admin else {}),
    } for r in (rows or []) if r["id"] != user["id"]]

@vault_router.put("/editors")
async def set_editors(data: VaultEditorsUpdate, request: Request):
    """Replace the set of vault editors (admin only)."""
    admin = await require_admin(request)
    ids = set()
    for raw in data.user_ids:
        try:
            ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    await execute_query("UPDATE users SET vault_editor = 0 WHERE role != 'admin'")
    names = []
    for uid in sorted(ids):
        row = await execute_query("SELECT name FROM users WHERE id = %s AND role != 'admin'", (uid,), fetch_one=True)
        if row:
            await execute_query("UPDATE users SET vault_editor = 1 WHERE id = %s", (uid,))
            names.append(row["name"])
    await _audit(None, "Vault editors", admin, "editors", request, ", ".join(names) or "none")
    return {"message": "Vault editors updated", "editors": names}
