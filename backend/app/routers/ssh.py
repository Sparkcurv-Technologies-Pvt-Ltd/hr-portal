"""Web SSH terminal for client servers (``/api/ssh``).

- Admins save each server's SSH address once, plus an L1 login and/or an L2 login (encrypted; never shown again).
- L1 / L2 engineers open a terminal in the browser; they never see the password or key. L1 can only use the L1 login,
  L2 can use either. Admins choose who is on the L1 / L2 team.
- Every session is logged (who, which server, which login, when, from where) and can be linked to a ticket, which then
  gets an internal note when the session starts and ends. Terminal contents are not recorded.

Permission-matrix module "ssh": View = open the terminal (if you're on the L1/L2 team) and see your own sessions,
Edit = manage servers, logins and the team and see every session, Delete = remove servers and logins.
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Optional

import asyncssh
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.core.config import allowed_origins
from app.core.permissions import effective_module_permissions, has_permission
from app.core.security import get_current_user, user_from_access_token
from app.core.vault_crypto import encrypt
from app.db import execute_query
from app.core.log import logger
from app.schemas.ssh import SshLoginIn, SshServerIn, SshTeamIn
from app.services import ssh as svc
from app.services.tickets import OPEN_STATUSES, now_iso


ssh_router = APIRouter(prefix="/ssh")
HOST_PATTERN = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.\-]*[A-Za-z0-9])?$|^[0-9A-Fa-f:]+$")


async def _has(user: dict, action: str) -> bool:
    if user.get("role") == "admin":
        return True
    return has_permission(await effective_module_permissions(user), "ssh", action)

async def _require(request: Request, action: str) -> dict:
    user = await get_current_user(request)
    if not await _has(user, action):
        raise HTTPException(status_code=403, detail=f"You don't have {action} access to the SSH terminal")
    return user

async def _team_level(user: dict) -> Optional[str]:
    """'l2' for admins, otherwise the level an admin gave them (None = not on the team, can't connect)."""
    if user.get("role") == "admin":
        return "l2"
    row = await execute_query("SELECT level FROM ssh_team WHERE user_id = %s", (user["id"],), fetch_one=True)
    return row["level"] if row else None

def _usable_levels(team_level: Optional[str], logins: set) -> list:
    """Logins the person may use: L1 → l1 only; L2 → l1 and l2."""
    allowed = {"l1": ("l1",), "l2": ("l1", "l2")}.get(team_level, ())
    return [lv for lv in svc.LEVELS if lv in allowed and lv in logins]

async def _server_or_404(server_id: int) -> dict:
    s = await execute_query("SELECT s.*, c.name AS client_name FROM ssh_servers s JOIN clients c ON c.id = s.client_id WHERE s.id = %s", (server_id,), fetch_one=True)
    if not s:
        raise HTTPException(status_code=404, detail="Server not found")
    return s

def _validate_server(data: SshServerIn) -> tuple:
    name, host = (data.name or "").strip(), (data.host or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a name for the server")
    if not HOST_PATTERN.match(host) or not 1 <= data.port <= 65535:
        raise HTTPException(status_code=400, detail="Enter a host name or IP address and a port (1–65535)")
    return name[:200], host[:255], data.port


# ---------- servers ----------

@ssh_router.get("/servers")
async def list_servers(request: Request):
    user = await _require(request, "view")
    can_edit = await _has(user, "edit")
    team_level = await _team_level(user)
    servers = await execute_query("SELECT s.*, c.name AS client_name FROM ssh_servers s JOIN clients c ON c.id = s.client_id ORDER BY c.name, s.name", fetch_all=True)
    logins = await execute_query("SELECT server_id, level, username, auth_type, updated_at, updated_by FROM ssh_logins", fetch_all=True)
    by_server = {}
    for lg in (logins or []):
        by_server.setdefault(lg["server_id"], {})[lg["level"]] = lg
    out = []
    for s in (servers or []):
        present = set(by_server.get(s["id"], {}))
        item = {"id": s["id"], "client_id": s["client_id"], "client_name": s["client_name"], "name": s["name"], "host": s["host"], "port": s["port"],
                "can_connect": _usable_levels(team_level, present), "pinned": bool(s["host_key"])}
        if can_edit:
            item["fingerprint"] = s["host_key_fingerprint"]; item["pinned_at"] = s["pinned_at"]
            item["logins"] = {lv: {"username": lg["username"], "auth_type": lg["auth_type"], "updated_at": lg["updated_at"], "updated_by": lg["updated_by"]} for lv, lg in by_server.get(s["id"], {}).items()}
        out.append(item)
    return {"servers": out, "my_level": team_level}

@ssh_router.post("/servers")
async def create_server(data: SshServerIn, request: Request):
    await _require(request, "edit")
    name, host, port = _validate_server(data)
    if not await execute_query("SELECT id FROM clients WHERE id = %s", (data.client_id,), fetch_one=True):
        raise HTTPException(status_code=400, detail="Client not found")
    key, fingerprint = await svc.fetch_host_key(host, port)
    new_id = await execute_query(
        "INSERT INTO ssh_servers (client_id, name, host, port, host_key, host_key_fingerprint, pinned_at, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (data.client_id, name, host, port, key, fingerprint, now_iso(), now_iso()), last_id=True
    )
    return {"id": new_id, "fingerprint": fingerprint, "message": "Server added — check the fingerprint matches the server's real SSH key"}

@ssh_router.put("/servers/{server_id}")
async def update_server(server_id: int, data: SshServerIn, request: Request):
    await _require(request, "edit")
    s = await _server_or_404(server_id)
    name, host, port = _validate_server(data)
    if not await execute_query("SELECT id FROM clients WHERE id = %s", (data.client_id,), fetch_one=True):
        raise HTTPException(status_code=400, detail="Client not found")
    key, fingerprint, pinned_at = s["host_key"], s["host_key_fingerprint"], s["pinned_at"]
    if (host, port) != (s["host"], s["port"]):   # a different machine: its key must be read again, and stored logins re-checked by an admin
        key, fingerprint = await svc.fetch_host_key(host, port); pinned_at = now_iso()
    await execute_query("UPDATE ssh_servers SET client_id = %s, name = %s, host = %s, port = %s, host_key = %s, host_key_fingerprint = %s, pinned_at = %s WHERE id = %s",
                        (data.client_id, name, host, port, key, fingerprint, pinned_at, server_id))
    return {"message": "Server updated", "fingerprint": fingerprint}

@ssh_router.post("/servers/{server_id}/repin")
async def repin_server(server_id: int, request: Request):
    """Read the server's host key again (e.g. after it was rebuilt). Connections only succeed against the pinned key."""
    user = await _require(request, "edit")
    s = await _server_or_404(server_id)
    key, fingerprint = await svc.fetch_host_key(s["host"], s["port"])
    await execute_query("UPDATE ssh_servers SET host_key = %s, host_key_fingerprint = %s, pinned_at = %s WHERE id = %s", (key, fingerprint, now_iso(), server_id))
    logger.warning(f"SSH host key re-pinned for {s['name']} by {user['email']}: {fingerprint}")
    return {"fingerprint": fingerprint, "changed": fingerprint != s["host_key_fingerprint"]}

@ssh_router.delete("/servers/{server_id}")
async def delete_server(server_id: int, request: Request):
    await _require(request, "delete")
    await _server_or_404(server_id)
    await execute_query("DELETE FROM ssh_logins WHERE server_id = %s", (server_id,))
    await execute_query("DELETE FROM ssh_servers WHERE id = %s", (server_id,))
    return {"message": "Server deleted"}

@ssh_router.put("/servers/{server_id}/logins/{level}")
async def save_login(server_id: int, level: str, data: SshLoginIn, request: Request):
    user = await _require(request, "edit")
    await _server_or_404(server_id)
    if level not in svc.LEVELS:
        raise HTTPException(status_code=400, detail="Level must be l1 or l2")
    username = (data.username or "").strip()
    if not username or len(username) > 100:
        raise HTTPException(status_code=400, detail="Enter the SSH username")
    if data.auth_type not in ("password", "key"):
        raise HTTPException(status_code=400, detail="Choose password or private key")
    existing = await execute_query("SELECT id FROM ssh_logins WHERE server_id = %s AND level = %s", (server_id, level), fetch_one=True)
    if not data.secret and not existing:
        raise HTTPException(status_code=400, detail="Enter the password or private key")
    if data.secret and data.auth_type == "key":
        try:
            asyncssh.import_private_key(data.secret, data.passphrase or None)
        except (asyncssh.KeyImportError, asyncssh.KeyEncryptionError) as e:
            raise HTTPException(status_code=400, detail=f"That private key can't be read ({e}). Paste the whole key, and its passphrase if it has one.")
    if existing:
        sets, args = ["username = %s", "auth_type = %s", "updated_at = %s", "updated_by = %s"], [username, data.auth_type, now_iso(), user["email"]]
        if data.secret:
            sets.append("secret_enc = %s"); args.append(encrypt(data.secret))
        if data.passphrase is not None:
            sets.append("passphrase_enc = %s"); args.append(encrypt(data.passphrase) if data.passphrase else None)
        await execute_query(f"UPDATE ssh_logins SET {', '.join(sets)} WHERE id = %s", tuple(args) + (existing["id"],))
    else:
        await execute_query(
            "INSERT INTO ssh_logins (server_id, level, username, auth_type, secret_enc, passphrase_enc, updated_at, updated_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (server_id, level, username, data.auth_type, encrypt(data.secret), encrypt(data.passphrase) if data.passphrase else None, now_iso(), user["email"])
        )
    logger.info(f"SSH {level} login for server {server_id} saved by {user['email']}")
    return {"message": f"{svc.LEVEL_LABEL[level]} login saved"}

@ssh_router.delete("/servers/{server_id}/logins/{level}")
async def delete_login(server_id: int, level: str, request: Request):
    await _require(request, "delete")
    if level not in svc.LEVELS or await execute_query("DELETE FROM ssh_logins WHERE server_id = %s AND level = %s", (server_id, level)) == 0:
        raise HTTPException(status_code=404, detail="Login not found")
    return {"message": "Login removed"}

@ssh_router.get("/servers/{server_id}/tickets")
async def open_tickets(server_id: int, request: Request):
    """Open tickets of the server's client, to link a session to."""
    await _require(request, "view")
    s = await _server_or_404(server_id)
    rows = await execute_query(f"SELECT id, subject, priority FROM tickets WHERE client_id = %s AND status IN ({', '.join(['%s'] * len(OPEN_STATUSES))}) ORDER BY id DESC LIMIT 50",
                               (s["client_id"],) + tuple(OPEN_STATUSES), fetch_all=True)
    return [{"id": r["id"], "number": f"TKT-{r['id']:04d}", "subject": r["subject"], "priority": r["priority"]} for r in (rows or [])]


# ---------- team ----------

@ssh_router.get("/team")
async def get_team(request: Request):
    await _require(request, "edit")
    rows = await execute_query("SELECT u.id, u.name, u.email, u.role, t.level FROM users u LEFT JOIN ssh_team t ON t.user_id = u.id WHERE u.role != 'admin' ORDER BY u.name", fetch_all=True)
    return [dict(r) for r in (rows or [])]

@ssh_router.put("/team/{user_id}")
async def set_team(user_id: int, data: SshTeamIn, request: Request):
    await _require(request, "edit")
    if data.level not in (None, "l1", "l2"):
        raise HTTPException(status_code=400, detail="Level must be l1, l2 or empty")
    target = await execute_query("SELECT id, role FROM users WHERE id = %s", (user_id,), fetch_one=True)
    if not target or target["role"] == "admin":
        raise HTTPException(status_code=404, detail="Employee not found")
    if data.level is None:
        await execute_query("DELETE FROM ssh_team WHERE user_id = %s", (user_id,))
    else:
        await execute_query("INSERT INTO ssh_team (user_id, level) VALUES (%s, %s) ON DUPLICATE KEY UPDATE level = VALUES(level)", (user_id, data.level))
    return {"message": "Team updated"}


# ---------- session log ----------

@ssh_router.get("/sessions")
async def list_sessions(request: Request, server_id: int = 0, limit: int = 200):
    user = await _require(request, "view")
    where, args = [], []
    if not await _has(user, "edit"):
        where.append("s.user_id = %s"); args.append(user["id"])
    if server_id:
        where.append("s.server_id = %s"); args.append(server_id)
    rows = await execute_query(
        "SELECT s.* FROM ssh_sessions s" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY s.id DESC LIMIT %s",
        tuple(args) + (max(1, min(limit, 500)),), fetch_all=True
    )
    return [{**r, "ticket_number": f"TKT-{r['ticket_id']:04d}" if r["ticket_id"] else None, "active": r["ended_at"] is None} for r in (rows or [])]


# ---------- the terminal (WebSocket) ----------

def _origin_ok(ws: WebSocket) -> bool:
    """Browsers always send Origin on WebSocket handshakes; only our own front end may open a terminal (blocks cross-site hijacking)."""
    origin = ws.headers.get("origin", "")
    return origin in allowed_origins or origin.rstrip("/") in [o.rstrip("/") for o in allowed_origins]

async def _status(ws: WebSocket, kind: str, message: str) -> None:
    await ws.send_text(json.dumps({"type": kind, "message": message}))

@ssh_router.websocket("/ws/{server_id}")
async def terminal(ws: WebSocket, server_id: int, level: str = "l1", ticket_id: int = 0, cols: int = 80, rows: int = 24):
    """Protocol: binary frames = terminal input / output; text frames = JSON ({"type": "resize", cols, rows} from the browser,
    {"type": "status" | "error" | "closed", message} from the server)."""
    if not _origin_ok(ws):
        await ws.close(code=4403); return
    try:
        user = await user_from_access_token(ws.cookies.get("access_token", ""))
    except HTTPException:
        await ws.close(code=4401); return
    await ws.accept()

    async def refuse(message: str) -> None:
        await _status(ws, "error", message)
        await ws.close(code=4400)

    if not await _has(user, "view"):
        return await refuse("You don't have access to the SSH terminal")
    team_level = await _team_level(user)
    if not team_level:
        return await refuse("You're not on the L1 / L2 support team — ask an admin to add you")
    s = await execute_query("SELECT s.*, c.name AS client_name FROM ssh_servers s JOIN clients c ON c.id = s.client_id WHERE s.id = %s", (server_id,), fetch_one=True)
    if not s:
        return await refuse("Server not found")
    login = await execute_query("SELECT * FROM ssh_logins WHERE server_id = %s AND level = %s", (server_id, level), fetch_one=True) if level in svc.LEVELS else None
    if not login or level not in _usable_levels(team_level, {level}):
        return await refuse(f"You can't use the {level.upper()} login on this server")
    ticket = None
    if ticket_id:
        ticket = await execute_query("SELECT id, client_id, status FROM tickets WHERE id = %s", (ticket_id,), fetch_one=True)
        if not ticket or ticket["client_id"] != s["client_id"] or ticket["status"] not in OPEN_STATUSES:
            return await refuse("Choose an open ticket of this client (or none)")
    if not svc.try_acquire(user["id"]):
        return await refuse(f"You already have {svc.MAX_SESSIONS_PER_USER} terminals open — close one first")

    session_id, conn, process, reason = None, None, None, "closed"
    ip = ws.client.host if ws.client else None
    started = datetime.now(timezone.utc)
    try:
        await _status(ws, "status", f"Connecting to {s['name']} as {login['username']} ({level.upper()})…")
        try:
            conn = await asyncssh.connect(**await svc.connect_options(s, login))
            process = await conn.create_process(term_type="xterm-256color", term_size=(max(20, min(cols, 400)), max(5, min(rows, 200))), encoding=None)
        except HTTPException as e:
            reason = "refused"; await _status(ws, "error", e.detail); return
        except asyncssh.HostKeyNotVerifiable:
            reason = "host key mismatch"; await _status(ws, "error", "The server's SSH host key doesn't match the pinned key. Someone may be intercepting the connection, or the server was rebuilt — ask an admin to check and re-pin it."); return
        except asyncssh.PermissionDenied:
            reason = "login rejected"; await _status(ws, "error", "The server rejected the stored login. Ask an admin to update it."); return
        except (asyncssh.Error, OSError, asyncio.TimeoutError) as e:
            reason = "connect failed"; await _status(ws, "error", f"Couldn't connect: {e or type(e).__name__}"); return

        session_id = await execute_query(
            """INSERT INTO ssh_sessions (server_id, server_name, client_name, user_id, user_name, level, login_username, ticket_id, ip, started_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (server_id, s["name"], s["client_name"], user["id"], user["name"], level, login["username"], ticket["id"] if ticket else None, ip, now_iso()), last_id=True
        )
        await svc.ticket_note(ticket["id"] if ticket else None, user, f"SSH session started on {s['name']} as {level.upper()} ({login['username']}).")
        await _status(ws, "status", "Connected")
        logger.info(f"SSH session {session_id}: {user['email']} -> {s['name']} ({level}) from {ip}")

        last_input = datetime.now(timezone.utc)

        async def ssh_to_browser():
            while True:
                data = await process.stdout.read(4096)
                if not data:
                    return "server closed the session"
                await ws.send_bytes(data)

        async def browser_to_ssh():
            nonlocal last_input
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return "browser closed"
                if msg.get("bytes"):
                    last_input = datetime.now(timezone.utc)
                    process.stdin.write(msg["bytes"])
                elif msg.get("text"):
                    try:
                        ctl = json.loads(msg["text"])
                    except ValueError:
                        continue
                    if ctl.get("type") == "resize":
                        process.change_terminal_size(max(20, min(int(ctl.get("cols", 80)), 400)), max(5, min(int(ctl.get("rows", 24)), 200)))

        async def watchdog():
            while True:
                await asyncio.sleep(5)
                now = datetime.now(timezone.utc)
                if (now - started).total_seconds() > svc.MAX_SESSION_SECONDS:
                    return "time limit reached"
                if (now - last_input).total_seconds() > svc.IDLE_TIMEOUT_SECONDS:
                    return "idle timeout"

        tasks = [asyncio.create_task(f()) for f in (ssh_to_browser, browser_to_ssh, watchdog)]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        finished = next(iter(done))
        exc = finished.exception()
        if exc is None:
            reason = finished.result()
        elif isinstance(exc, (asyncssh.Error, OSError, WebSocketDisconnect, RuntimeError)):
            reason = "connection closed"          # either side hung up while we were relaying
        else:
            reason = f"error: {type(exc).__name__}"
            logger.warning(f"SSH session {session_id} ended by an error: {exc!r}")
    except Exception as e:
        reason = "error"
        logger.warning(f"SSH session error ({user['email']} -> {s['name']}): {type(e).__name__}: {e}")
    finally:
        svc.release(user["id"])
        for closer in (process and process.close, conn and conn.close):
            try:
                closer and closer()
            except Exception:
                pass
        if session_id:
            try:
                await execute_query("UPDATE ssh_sessions SET ended_at = %s, end_reason = %s WHERE id = %s", (now_iso(), reason[:120], session_id))
                minutes = max(1, round((datetime.now(timezone.utc) - started).total_seconds() / 60))
                await svc.ticket_note(ticket["id"] if ticket else None, user, f"SSH session on {s['name']} ended after {minutes} min ({reason}).")
            except Exception as e:
                logger.warning(f"Couldn't close SSH session record {session_id}: {e}")
        try:
            await _status(ws, "closed", reason)
            await ws.close()
        except Exception:
            pass
