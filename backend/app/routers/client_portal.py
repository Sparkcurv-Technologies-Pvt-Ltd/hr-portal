"""Client portal (``/api/client``): clients sign in with their own account, raise tickets and reply.

Everything is scoped to the signed-in contact's company; internal notes, history, SLA and assignee never leave the
staff side.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.client_auth import CLIENT_COOKIE, CLIENT_TOKEN_HOURS, create_client_token, get_current_client
from app.core.config import COOKIE_SAMESITE, COOKIE_SECURE
from app.core.security import verify_password
from app.db import execute_query
from app.schemas.tickets import ClientLogin, ClientTicketIn, ReplyIn
from app.services import tickets as svc
from app.services.workflow import TICKET_WORKFLOW, check_transition


client_router = APIRouter(prefix="/client")


async def _own_ticket(client: dict, ticket_id: int) -> dict:
    t = await svc.load_ticket(ticket_id)
    if t["client_id"] != client["client_id"]:
        raise HTTPException(status_code=404, detail="Ticket not found")   # same answer as "doesn't exist"
    return t


@client_router.post("/login")
async def client_login(data: ClientLogin, response: Response):
    contact = await execute_query(
        """SELECT c.*, cl.name AS client_name, cl.status AS client_status FROM client_contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.email = %s""",
        ((data.email or "").strip().lower(),), fetch_one=True
    )
    if not contact or not verify_password(data.password, contact["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not contact["active"] or contact["client_status"] != "active":
        raise HTTPException(status_code=403, detail="This account is disabled. Please contact support.")
    await execute_query("UPDATE client_contacts SET last_login = %s WHERE id = %s", (svc.now_iso(), contact["id"]))
    response.set_cookie(key=CLIENT_COOKIE, value=create_client_token(contact["id"]), httponly=True, secure=COOKIE_SECURE,
                        samesite=COOKIE_SAMESITE, max_age=CLIENT_TOKEN_HOURS * 3600, path="/")
    return {"id": contact["id"], "name": contact["name"], "email": contact["email"], "client_name": contact["client_name"]}

@client_router.post("/logout")
async def client_logout(response: Response):
    response.delete_cookie(key=CLIENT_COOKIE, path="/")
    return {"message": "Logged out"}

@client_router.get("/me")
async def client_me(request: Request):
    c = await get_current_client(request)
    return {"id": c["id"], "name": c["name"], "email": c["email"], "client_name": c["client_name"]}

@client_router.get("/servers")
async def my_servers(request: Request):
    """Status of the servers we monitor for this client (names and status only — no addresses or internals)."""
    c = await get_current_client(request)
    rows = await execute_query("SELECT id, name, type, status, last_checked_at FROM monitors WHERE client_id = %s AND enabled = 1 AND visible_to_client = 1 ORDER BY name", (c["client_id"],), fetch_all=True)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    stats = await execute_query("SELECT monitor_id, SUM(ok) AS ok, COUNT(*) AS n FROM monitor_checks WHERE checked_at >= %s GROUP BY monitor_id", (since,), fetch_all=True)
    uptime = {s["monitor_id"]: round(100.0 * float(s["ok"]) / s["n"], 2) for s in (stats or []) if s["n"]}
    return [{"id": r["id"], "name": r["name"], "type": r["type"], "status": r["status"], "last_checked_at": r["last_checked_at"], "uptime_30d": uptime.get(r["id"])} for r in (rows or [])]

@client_router.get("/tickets")
async def my_tickets(request: Request):
    c = await get_current_client(request)
    rows = await execute_query(svc.TICKET_SELECT + " WHERE t.client_id = %s ORDER BY t.id DESC", (c["client_id"],), fetch_all=True)
    return [svc.ticket_out(r, for_client=True) for r in (rows or [])]

@client_router.post("/tickets")
async def create_my_ticket(data: ClientTicketIn, request: Request):
    c = await get_current_client(request)
    subject = (data.subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Please enter a subject")
    category, priority = svc.check(data.category, svc.CATEGORIES, "category"), svc.check(data.priority, svc.PRIORITIES, "priority")
    now = svc.now_iso()
    new_id = await execute_query(
        """INSERT INTO tickets (client_id, contact_id, subject, description, category, priority, status, due_at, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, 'open', %s, %s, %s)""",
        (c["client_id"], c["id"], subject[:255], (data.description or "")[:5000], category, priority, svc.sla_due(priority), now, now), last_id=True
    )
    await svc.log_change(new_id, c["name"], "created", None, svc.number(new_id))
    t = await svc.load_ticket(new_id)
    svc.notify_staff_new(t)
    svc.notify_client(t, "We've received your ticket", "Thanks for contacting us. Our team will review your ticket and reply soon.")
    return svc.ticket_out(t, for_client=True)

@client_router.get("/tickets/{ticket_id}")
async def my_ticket(ticket_id: int, request: Request):
    c = await get_current_client(request)
    t = await _own_ticket(c, ticket_id)
    replies = await execute_query("SELECT id, author_type, author_name, body, created_at FROM ticket_replies WHERE ticket_id = %s AND internal = 0 ORDER BY id", (ticket_id,), fetch_all=True)
    return {**svc.ticket_out(t, for_client=True), "replies": [dict(r) for r in (replies or [])]}

@client_router.post("/tickets/{ticket_id}/replies")
async def reply(ticket_id: int, data: ReplyIn, request: Request):
    c = await get_current_client(request)
    t = await _own_ticket(c, ticket_id)
    if t["status"] == "closed":
        raise HTTPException(status_code=400, detail="This ticket is closed. Please open a new ticket.")
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Reply can't be empty")
    await execute_query("INSERT INTO ticket_replies (ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES (%s, 'client', %s, %s, %s, 0, %s)",
                        (ticket_id, c["id"], c["name"], body[:5000], svc.now_iso()))
    new_status = "open" if t["status"] in ("waiting_client", "resolved") else t["status"]   # a client reply reopens it
    check_transition(TICKET_WORKFLOW, t["status"], new_status)
    await execute_query("UPDATE tickets SET status = %s, resolved_at = NULL, updated_at = %s WHERE id = %s", (new_status, svc.now_iso(), ticket_id))
    if new_status != t["status"]:
        await svc.log_change(ticket_id, c["name"], "status", t["status"], new_status)
    svc.notify_staff_reply({**t, "status": new_status}, c["name"])
    return {"message": "Reply sent"}

@client_router.post("/tickets/{ticket_id}/close")
async def close_my_ticket(ticket_id: int, request: Request):
    c = await get_current_client(request)
    t = await _own_ticket(c, ticket_id)
    check_transition(TICKET_WORKFLOW, t["status"], "closed")   # only a resolved ticket can be closed
    if t["status"] != "closed":
        await execute_query("UPDATE tickets SET status = 'closed', resolved_at = COALESCE(resolved_at, %s), updated_at = %s WHERE id = %s", (svc.now_iso(), svc.now_iso(), ticket_id))
        await svc.log_change(ticket_id, c["name"], "status", t["status"], "closed")
    return {"message": "Ticket closed"}
