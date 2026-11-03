"""Shared pieces of client ticketing: vocabularies, SLA, serialising, history and email notifications."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from app.core.config import FRONTEND_URL, TICKET_NOTIFY_EMAILS, TICKET_SLA_HOURS
from app.core.email import _send_email, _ticket_email_html
from app.db import execute_query

CATEGORIES = ("support", "bug", "feature", "billing", "other")
PRIORITIES = ("low", "medium", "high", "urgent")
STATUSES = ("open", "in_progress", "waiting_client", "resolved", "closed")
OPEN_STATUSES = ("open", "in_progress", "waiting_client")   # not yet resolved: SLA clock still counts
STATUS_LABEL = {"open": "Open", "in_progress": "In progress", "waiting_client": "Waiting on client", "resolved": "Resolved", "closed": "Closed"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def number(ticket_id: int) -> str:
    return f"TKT-{ticket_id:04d}"

def check(value: str, allowed: tuple, label: str) -> str:
    if value not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return value

def sla_due(priority: str, start: Optional[datetime] = None) -> str:
    return ((start or datetime.now(timezone.utc)) + timedelta(hours=TICKET_SLA_HOURS.get(priority, 24))).isoformat()

def clean_due(value: Optional[str]) -> Optional[str]:
    """Accept an ISO date or datetime; store as UTC ISO text."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Due date is not valid")
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()

def is_overdue(row: dict) -> bool:
    return row["status"] in OPEN_STATUSES and bool(row.get("due_at")) and row["due_at"] < now_iso()

TICKET_SELECT = """SELECT t.*, cl.name AS client_name, ct.name AS contact_name, ct.email AS contact_email,
                          a.name AS assignee_name, a.email AS assignee_email, a.avatar_url AS assignee_avatar,
                          (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id AND r.internal = 0) AS reply_count
                   FROM tickets t JOIN clients cl ON cl.id = t.client_id
                   LEFT JOIN client_contacts ct ON ct.id = t.contact_id
                   LEFT JOIN users a ON a.id = t.assignee_id"""

def ticket_out(r: dict, for_client: bool = False) -> dict:
    out = {
        "id": r["id"], "number": number(r["id"]), "client_id": r["client_id"], "client_name": r["client_name"],
        "contact_id": r["contact_id"], "contact_name": r.get("contact_name"), "subject": r["subject"], "description": r["description"] or "",
        "category": r["category"], "priority": r["priority"], "status": r["status"], "due_at": r["due_at"], "overdue": is_overdue(r),
        "created_at": r["created_at"], "updated_at": r["updated_at"], "resolved_at": r["resolved_at"], "reply_count": int(r.get("reply_count") or 0),
        "assignee_name": r.get("assignee_name"),
    }
    if not for_client:
        out.update({"assignee_id": r["assignee_id"], "assignee_avatar": r.get("assignee_avatar"), "contact_email": r.get("contact_email"),
                    "first_response_at": r["first_response_at"]})
    else:
        out.pop("due_at"); out.pop("overdue")   # internal SLA is not shown to clients
        out["assignee_name"] = None
    return out

async def load_ticket(ticket_id: int) -> dict:
    row = await execute_query(TICKET_SELECT + " WHERE t.id = %s", (ticket_id,), fetch_one=True)
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return row

async def log_change(ticket_id: int, who: str, field: str, old, new) -> None:
    await execute_query(
        "INSERT INTO ticket_activity (ticket_id, user_name, field, old_value, new_value, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
        (ticket_id, who, field, None if old is None else str(old)[:255], None if new is None else str(new)[:255], now_iso())
    )

async def log_diffs(ticket_id: int, who: str, before: dict, after: dict) -> None:
    for field, key in (("subject", "subject"), ("category", "category"), ("priority", "priority"), ("status", "status"),
                       ("assignee", "assignee_name"), ("due date", "due_at")):
        if (before.get(key) or None) != (after.get(key) or None):
            await log_change(ticket_id, who, field, before.get(key), after.get(key))


# ---------- email ----------

def _spawn(recipients: list, subject: str, page: str, category: str) -> None:
    recipients = [r for r in dict.fromkeys(e for e in recipients if e)]
    if recipients:
        asyncio.get_event_loop().run_in_executor(None, _send_email, recipients, subject, page, category)

def _staff_url() -> str:
    return f"{FRONTEND_URL.rstrip('/')}/login"

def _client_url() -> str:
    return f"{FRONTEND_URL.rstrip('/')}/client"

def _client_address(t: dict) -> Optional[str]:
    return t.get("contact_email")

def notify_client(t: dict, heading: str, message: str, *, accent: str = "blue", extra: Optional[list] = None) -> None:
    to = _client_address(t)
    if not to:
        return
    fields = [("Status", STATUS_LABEL.get(t["status"], t["status"]))] + (extra or [])
    page = _ticket_email_html(heading, number(t["id"]), t["subject"], fields, message, accent=accent, url=_client_url(), button="Open your tickets")
    _spawn([to], f"{number(t['id'])}: {heading}", page, "tickets_clients")

def notify_assignee(t: dict, assigned_by: str) -> None:
    if not t.get("assignee_email"):
        return
    fields = [("Client", t["client_name"]), ("Priority", t["priority"].title()), ("Category", t["category"].title()), ("Assigned by", assigned_by)]
    page = _ticket_email_html("Ticket assigned to you", number(t["id"]), t["subject"], fields,
                              f"Hi {t['assignee_name']}, a client ticket has been assigned to you.", url=_staff_url(), button="Open the portal")
    _spawn([t["assignee_email"]], f"{number(t['id'])}: assigned to you", page, "tickets_team")

def notify_staff_new(t: dict) -> None:
    """A client raised a ticket: tell the team."""
    fields = [("Client", t["client_name"]), ("Raised by", t.get("contact_name") or "—"), ("Priority", t["priority"].title()), ("Category", t["category"].title())]
    page = _ticket_email_html("New client ticket", number(t["id"]), t["subject"], fields,
                              "A client has raised a new support ticket.", accent="amber", url=_staff_url(), button="Open the portal")
    _spawn(list(TICKET_NOTIFY_EMAILS) + [t.get("assignee_email")], f"New ticket {number(t['id'])} from {t['client_name']}", page, "tickets_team")

def notify_staff_reply(t: dict, who: str) -> None:
    """A client replied: tell the assignee (or the team when nobody owns it)."""
    to = [t["assignee_email"]] if t.get("assignee_email") else list(TICKET_NOTIFY_EMAILS)
    fields = [("Client", t["client_name"]), ("Reply from", who), ("Status", STATUS_LABEL.get(t["status"], t["status"]))]
    page = _ticket_email_html("Client replied", number(t["id"]), t["subject"], fields, "The client added a reply to this ticket.",
                              accent="amber", url=_staff_url(), button="Open the portal")
    _spawn(to, f"{number(t['id'])}: client replied", page, "tickets_team")
