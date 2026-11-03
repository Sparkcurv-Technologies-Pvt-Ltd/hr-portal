"""Client ticketing for staff (``/api/tickets``).

Access follows the "tickets" module in the permission matrix (admins always have everything):
View = see every ticket and client, Edit = log tickets for clients, reply, change status/priority/assignee and
manage clients and their portal logins, Delete = delete tickets, clients and contacts.
Nobody without a grant can open the module at all. With View, a person can also reply to and move the tickets
assigned to them.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.config import TICKET_SLA_HOURS
from app.core.permissions import effective_module_permissions, has_permission
from app.core.security import get_current_user, hash_password
from app.db import execute_query
from app.schemas.tickets import ClientIn, ContactIn, ContactUpdate, ReplyIn, TicketIn, TicketStatusIn, TicketUpdate
from app.services import tickets as svc
from app.services.workflow import TICKET_INITIAL, TICKET_WORKFLOW, check_transition


tickets_router = APIRouter(prefix="/tickets")
MIN_PASSWORD_LENGTH = 8


async def _has(user: dict, action: str) -> bool:
    if user.get("role") == "admin":
        return True
    return has_permission(await effective_module_permissions(user), "tickets", action)

async def _require(request: Request, action: str) -> dict:
    user = await get_current_user(request)
    if not await _has(user, action):
        raise HTTPException(status_code=403, detail=f"You don't have {action} access to tickets")
    return user

def _password_or_400(password: str) -> str:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return password

async def _assignee_or_400(assignee_id):
    if assignee_id is None:
        return
    if not await execute_query("SELECT id FROM users WHERE id = %s", (assignee_id,), fetch_one=True):
        raise HTTPException(status_code=400, detail="Assignee not found")


# ---------- lookups & dashboard ----------

@tickets_router.get("/meta")
async def meta(request: Request):
    user = await _require(request, "view")
    can_edit = await _has(user, "edit")
    staff = await execute_query("SELECT id, name, role FROM users ORDER BY name", fetch_all=True) if can_edit else []
    return {
        "categories": svc.CATEGORIES, "priorities": svc.PRIORITIES, "statuses": svc.STATUSES,
        "status_labels": svc.STATUS_LABEL, "workflow": {"initial": TICKET_INITIAL, "transitions": TICKET_WORKFLOW}, "sla_hours": TICKET_SLA_HOURS,
        "staff": [dict(s) for s in (staff or [])],
    }

@tickets_router.get("/stats")
async def stats(request: Request):
    await _require(request, "view")
    rows = await execute_query(svc.TICKET_SELECT, fetch_all=True)
    rows = rows or []
    by_status = {s: 0 for s in svc.STATUSES}; by_priority = {p: 0 for p in svc.PRIORITIES}; by_client = {}
    overdue = unassigned = 0
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        if r["status"] in svc.OPEN_STATUSES:
            by_priority[r["priority"]] = by_priority.get(r["priority"], 0) + 1
            by_client[r["client_name"]] = by_client.get(r["client_name"], 0) + 1
            overdue += svc.is_overdue(r)
            unassigned += r["assignee_id"] is None
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    return {
        "total": len(rows), "open": sum(by_status[s] for s in svc.OPEN_STATUSES), "overdue": overdue, "unassigned": unassigned,
        "resolved_week": sum(1 for r in rows if r["resolved_at"] and r["resolved_at"] >= week_ago),
        "by_status": by_status, "by_priority": by_priority,
        "by_client": [{"client": k, "open": v} for k, v in sorted(by_client.items(), key=lambda kv: -kv[1])[:8]],
    }


# ---------- clients & contacts (portal logins) ----------

@tickets_router.get("/clients")
async def list_clients(request: Request):
    await _require(request, "view")
    rows = await execute_query(
        """SELECT cl.*, (SELECT COUNT(*) FROM client_contacts c WHERE c.client_id = cl.id) AS contacts,
                  (SELECT COUNT(*) FROM tickets t WHERE t.client_id = cl.id AND t.status IN ('open','in_progress','waiting_client')) AS open_tickets,
                  (SELECT COUNT(*) FROM tickets t WHERE t.client_id = cl.id) AS total_tickets
           FROM clients cl ORDER BY cl.status = 'inactive', cl.name""", fetch_all=True
    )
    return [{"id": r["id"], "name": r["name"], "email": r["email"], "phone": r["phone"], "address": r["address"] or "", "notes": r["notes"] or "",
             "status": r["status"], "contacts": int(r["contacts"]), "open_tickets": int(r["open_tickets"]), "total_tickets": int(r["total_tickets"])} for r in (rows or [])]

def _client_values(data: ClientIn) -> tuple:
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Client name is required")
    return name[:200], (data.email or "").strip()[:255], (data.phone or "").strip()[:50], data.address or "", data.notes or "", svc.check(data.status, ("active", "inactive"), "status")

@tickets_router.post("/clients")
async def create_client(data: ClientIn, request: Request):
    await _require(request, "edit")
    name, email, phone, address, notes, status = _client_values(data)
    if await execute_query("SELECT id FROM clients WHERE name = %s", (name,), fetch_one=True):
        raise HTTPException(status_code=400, detail="A client with this name already exists")
    new_id = await execute_query("INSERT INTO clients (name, email, phone, address, notes, status, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                                 (name, email, phone, address, notes, status, svc.now_iso()), last_id=True)
    return {"id": new_id, "message": "Client created"}

@tickets_router.put("/clients/{client_id}")
async def update_client(client_id: int, data: ClientIn, request: Request):
    await _require(request, "edit")
    name, email, phone, address, notes, status = _client_values(data)
    clash = await execute_query("SELECT id FROM clients WHERE name = %s AND id != %s", (name, client_id), fetch_one=True)
    if clash:
        raise HTTPException(status_code=400, detail="A client with this name already exists")
    if not await execute_query("SELECT id FROM clients WHERE id = %s", (client_id,), fetch_one=True):
        raise HTTPException(status_code=404, detail="Client not found")
    await execute_query("UPDATE clients SET name = %s, email = %s, phone = %s, address = %s, notes = %s, status = %s WHERE id = %s",
                        (name, email, phone, address, notes, status, client_id))
    return {"message": "Client updated"}

@tickets_router.delete("/clients/{client_id}")
async def delete_client(client_id: int, request: Request):
    await _require(request, "delete")
    if await execute_query("SELECT id FROM tickets WHERE client_id = %s LIMIT 1", (client_id,), fetch_one=True):
        raise HTTPException(status_code=400, detail="This client has tickets — mark it inactive instead of deleting it")
    await execute_query("DELETE FROM client_contacts WHERE client_id = %s", (client_id,))
    if await execute_query("DELETE FROM clients WHERE id = %s", (client_id,)) == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client deleted"}

@tickets_router.get("/clients/{client_id}/contacts")
async def list_contacts(client_id: int, request: Request):
    await _require(request, "view")
    rows = await execute_query("SELECT id, client_id, name, email, phone, active, last_login FROM client_contacts WHERE client_id = %s ORDER BY name", (client_id,), fetch_all=True)
    return [{**r, "active": bool(r["active"])} for r in (rows or [])]

@tickets_router.post("/clients/{client_id}/contacts")
async def create_contact(client_id: int, data: ContactIn, request: Request):
    await _require(request, "edit")
    if not await execute_query("SELECT id FROM clients WHERE id = %s", (client_id,), fetch_one=True):
        raise HTTPException(status_code=404, detail="Client not found")
    name, email = (data.name or "").strip(), (data.email or "").strip().lower()
    if not name or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter the contact's name and a valid email")
    if await execute_query("SELECT id FROM client_contacts WHERE email = %s", (email,), fetch_one=True):
        raise HTTPException(status_code=400, detail="This email already has a client login")
    new_id = await execute_query(
        "INSERT INTO client_contacts (client_id, name, email, phone, password_hash, active, created_at) VALUES (%s, %s, %s, %s, %s, 1, %s)",
        (client_id, name[:200], email, (data.phone or "").strip()[:50], hash_password(_password_or_400(data.password)), svc.now_iso()), last_id=True
    )
    return {"id": new_id, "message": "Contact added"}

@tickets_router.put("/contacts/{contact_id}")
async def update_contact(contact_id: int, data: ContactUpdate, request: Request):
    await _require(request, "edit")
    if not await execute_query("SELECT id FROM client_contacts WHERE id = %s", (contact_id,), fetch_one=True):
        raise HTTPException(status_code=404, detail="Contact not found")
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Contact name is required")
    await execute_query("UPDATE client_contacts SET name = %s, phone = %s, active = %s WHERE id = %s", (name[:200], (data.phone or "").strip()[:50], int(data.active), contact_id))
    if data.password:
        await execute_query("UPDATE client_contacts SET password_hash = %s WHERE id = %s", (hash_password(_password_or_400(data.password)), contact_id))
    return {"message": "Contact updated"}

@tickets_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: int, request: Request):
    await _require(request, "delete")
    await execute_query("UPDATE tickets SET contact_id = NULL WHERE contact_id = %s", (contact_id,))
    if await execute_query("DELETE FROM client_contacts WHERE id = %s", (contact_id,)) == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted"}


# ---------- tickets ----------

@tickets_router.get("")
async def list_tickets(request: Request, status: str = "", priority: str = "", category: str = "", client_id: int = 0,
                       assignee: str = "", q: str = "", overdue: bool = False, open_only: bool = False, limit: int = 300):
    await _require(request, "view")
    where, args = [], []
    for column, value in (("t.status", status), ("t.priority", priority), ("t.category", category)):
        if value:
            where.append(f"{column} = %s"); args.append(value)
    if open_only:
        where.append("t.status IN ('open', 'in_progress', 'waiting_client')")
    if client_id:
        where.append("t.client_id = %s"); args.append(client_id)
    if assignee == "none":
        where.append("t.assignee_id IS NULL")
    elif assignee.isdigit():
        where.append("t.assignee_id = %s"); args.append(int(assignee))
    if overdue:   # filter in SQL so LIMIT applies to overdue tickets, not to the newest N
        where.append("t.status IN ('open','in_progress','waiting_client') AND t.due_at IS NOT NULL AND t.due_at < %s"); args.append(svc.now_iso())
    if q.strip():
        term = q.strip()
        like = f"%{term}%"
        digits = term.upper().replace("TKT-", "")
        where.append("(t.subject LIKE %s OR cl.name LIKE %s OR t.id = %s)"); args += [like, like, int(digits) if digits.isdigit() else 0]
    rows = await execute_query(svc.TICKET_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY t.id DESC LIMIT %s", tuple(args) + (max(1, min(limit, 500)),), fetch_all=True)
    out = [svc.ticket_out(r) for r in (rows or [])]
    return [t for t in out if t["overdue"]] if overdue else out

@tickets_router.post("")
async def create_ticket(data: TicketIn, request: Request):
    user = await _require(request, "edit")
    subject = (data.subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required")
    client = await execute_query("SELECT id FROM clients WHERE id = %s", (data.client_id,), fetch_one=True)
    if not client:
        raise HTTPException(status_code=400, detail="Client not found")
    if data.contact_id and not await execute_query("SELECT id FROM client_contacts WHERE id = %s AND client_id = %s", (data.contact_id, data.client_id), fetch_one=True):
        raise HTTPException(status_code=400, detail="That contact doesn't belong to this client")
    await _assignee_or_400(data.assignee_id)
    category, priority = svc.check(data.category, svc.CATEGORIES, "category"), svc.check(data.priority, svc.PRIORITIES, "priority")
    now = svc.now_iso()
    new_id = await execute_query(
        """INSERT INTO tickets (client_id, contact_id, subject, description, category, priority, status, assignee_id, created_by, due_at, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, 'open', %s, %s, %s, %s, %s)""",
        (data.client_id, data.contact_id, subject[:255], data.description or "", category, priority, data.assignee_id, user["id"],
         svc.clean_due(data.due_at) or svc.sla_due(priority), now, now), last_id=True
    )
    await svc.log_change(new_id, user["name"], "created", None, svc.number(new_id))
    t = await svc.load_ticket(new_id)
    if t["assignee_email"] and t["assignee_id"] != user["id"]:
        svc.notify_assignee(t, user["name"])
    svc.notify_client(t, "We've logged your ticket", "Our team has logged a support ticket for you and will get back to you soon.")
    return svc.ticket_out(t)

@tickets_router.get("/{ticket_id}")
async def get_ticket(ticket_id: int, request: Request):
    await _require(request, "view")
    t = await svc.load_ticket(ticket_id)
    replies = await execute_query("SELECT id, author_type, author_name, body, internal, created_at FROM ticket_replies WHERE ticket_id = %s ORDER BY id", (ticket_id,), fetch_all=True)
    activity = await execute_query("SELECT id, user_name, field, old_value, new_value, created_at FROM ticket_activity WHERE ticket_id = %s ORDER BY id DESC", (ticket_id,), fetch_all=True)
    return {**svc.ticket_out(t), "replies": [{**r, "internal": bool(r["internal"])} for r in (replies or [])], "activity": [dict(a) for a in (activity or [])]}

@tickets_router.put("/{ticket_id}")
async def update_ticket(ticket_id: int, data: TicketUpdate, request: Request):
    user = await _require(request, "edit")
    before = await svc.load_ticket(ticket_id)
    subject = (data.subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required")
    await _assignee_or_400(data.assignee_id)
    category, priority, status = svc.check(data.category, svc.CATEGORIES, "category"), svc.check(data.priority, svc.PRIORITIES, "priority"), svc.check(data.status, svc.STATUSES, "status")
    check_transition(TICKET_WORKFLOW, before["status"], status)
    due = svc.clean_due(data.due_at)
    # The edit form always sends the current due time back. If the priority changed and the due time wasn't edited
    # (or was cleared), the SLA follows the new priority; a blank due time resets it to the SLA for the priority.
    unedited = bool(due) and due[:16] == (before["due_at"] or "")[:16]
    if not due or (priority != before["priority"] and unedited):
        due = svc.sla_due(priority, datetime.fromisoformat(before["created_at"]))
    resolved_at = before["resolved_at"] if status in ("resolved", "closed") and before["resolved_at"] else (svc.now_iso() if status in ("resolved", "closed") else None)
    await execute_query(
        """UPDATE tickets SET subject = %s, description = %s, category = %s, priority = %s, status = %s, assignee_id = %s, due_at = %s,
           resolved_at = %s, updated_at = %s WHERE id = %s""",
        (subject[:255], data.description or "", category, priority, status, data.assignee_id, due or before["due_at"], resolved_at, svc.now_iso(), ticket_id)
    )
    after = await svc.load_ticket(ticket_id)
    await svc.log_diffs(ticket_id, user["name"], before, after)
    if after["assignee_id"] and after["assignee_id"] != before["assignee_id"] and after["assignee_id"] != user["id"]:
        svc.notify_assignee(after, user["name"])
    if status != before["status"] and status in ("resolved", "closed"):
        svc.notify_client(after, f"Your ticket was {status}", f"Your ticket has been marked {status}. If it isn't fully solved, just reply and we'll reopen it." if status == "resolved" else "Your ticket has been closed.", accent="green")
    return svc.ticket_out(after)

@tickets_router.put("/{ticket_id}/status")
async def update_status(ticket_id: int, data: TicketStatusIn, request: Request):
    """The assignee (or anyone with Edit) moves a ticket through its statuses."""
    user = await _require(request, "view")
    t = await svc.load_ticket(ticket_id)
    if t["assignee_id"] != user["id"] and not await _has(user, "edit"):
        raise HTTPException(status_code=403, detail="You can only update tickets assigned to you")
    status = svc.check(data.status, svc.STATUSES, "status")
    check_transition(TICKET_WORKFLOW, t["status"], status)
    if status != t["status"]:
        resolved_at = t["resolved_at"] or svc.now_iso() if status in ("resolved", "closed") else None
        await execute_query("UPDATE tickets SET status = %s, resolved_at = %s, updated_at = %s WHERE id = %s", (status, resolved_at, svc.now_iso(), ticket_id))
        await svc.log_change(ticket_id, user["name"], "status", t["status"], status)
        if status in ("resolved", "closed"):
            svc.notify_client({**t, "status": status}, f"Your ticket was {status}", "Your ticket has been marked " + status + ". If it isn't fully solved, just reply and we'll reopen it." if status == "resolved" else "Your ticket has been closed.", accent="green")
    return svc.ticket_out(await svc.load_ticket(ticket_id))

@tickets_router.post("/{ticket_id}/replies")
async def add_reply(ticket_id: int, data: ReplyIn, request: Request):
    user = await _require(request, "view")
    t = await svc.load_ticket(ticket_id)
    if t["assignee_id"] != user["id"] and not await _has(user, "edit"):
        raise HTTPException(status_code=403, detail="You can only reply to tickets assigned to you")
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Reply can't be empty")
    await execute_query("INSERT INTO ticket_replies (ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES (%s, 'staff', %s, %s, %s, %s, %s)",
                        (ticket_id, user["id"], user["name"], body[:5000], int(data.internal), svc.now_iso()))
    await execute_query("UPDATE tickets SET updated_at = %s WHERE id = %s", (svc.now_iso(), ticket_id))
    if not data.internal:
        if not t["first_response_at"]:
            await execute_query("UPDATE tickets SET first_response_at = %s WHERE id = %s", (svc.now_iso(), ticket_id))
        svc.notify_client(t, "New reply on your ticket", f"{user['name']} replied to your ticket. Open the client portal to read it and respond.", extra=[("Reply from", user["name"])])
    return {"message": "Note added" if data.internal else "Reply sent"}

@tickets_router.delete("/{ticket_id}")
async def delete_ticket(ticket_id: int, request: Request):
    await _require(request, "delete")
    await svc.load_ticket(ticket_id)
    for table in ("ticket_replies", "ticket_activity"):
        await execute_query(f"DELETE FROM {table} WHERE ticket_id = %s", (ticket_id,))
    await execute_query("DELETE FROM tickets WHERE id = %s", (ticket_id,))
    return {"message": "Ticket deleted"}
