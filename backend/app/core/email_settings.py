"""Per-employee email preferences: an admin can switch off all email to a person, or any one kind of notification.

Everything that sends mail goes through ``_send_email`` / ``_send_email_with_pdf`` in ``app.core.email``, which drop the
addresses for which ``is_muted(address, category)`` is true. Senders run in worker threads, so the answer is read from an
in-memory copy that is refreshed right after a change and every few seconds (to pick up changes made in another process).
"""

import asyncio

from app.core.log import logger
from app.db import execute_query

# (key, label, what it covers) — shown in the per-employee email dialog
CATEGORIES = [
    ("requests", "Leave, permission & WFH requests", "New request alerts to the team and approval / rejection emails to employees."),
    ("change_requests", "Change requests", "New change request and manager-approved emails."),
    ("attendance", "Attendance emails", "10:00 AM login reminders, 6:30 PM logout reminders and emergency logout alerts."),
    ("payslips", "Payslips", "Payslip PDF emailed to the employee when it is generated or re-sent."),
    ("projects", "Project task assignments", "Email to a person when an issue is assigned to them."),
    ("tickets_team", "Client tickets: team alerts", "New client ticket, client reply and assignment emails to your team."),
    ("monitoring", "Server monitoring alerts", "Down and recovered alerts for client servers."),
    ("tickets_clients", "Client tickets: emails to clients", "Confirmation, staff reply and resolved / closed emails to the client."),
]
REFRESH_SECONDS = 10

_muted: set = set()   # lower-cased addresses of employees whose email notifications an admin switched off entirely
_muted_modules: dict = {}   # lower-cased address -> set of categories switched off for that employee only
# Kinds of email an employee can receive (client emails go to clients, not employees)
PERSON_CATEGORIES = [c for c in CATEGORIES if c[0] != "tickets_clients"]
PERSON_KEYS = {c[0] for c in PERSON_CATEGORIES}


def is_muted(address: str, category: str = None) -> bool:
    """Nothing for this person at all, or nothing of this category."""
    a = (address or "").strip().lower()
    return a in _muted or bool(category and category in _muted_modules.get(a, ()))


def set_muted(address: str, muted: bool) -> None:
    (_muted.add if muted else _muted.discard)((address or "").strip().lower())


def set_muted_modules(address: str, categories: set) -> None:
    a = (address or "").strip().lower()
    if categories:
        _muted_modules[a] = set(categories)
    else:
        _muted_modules.pop(a, None)


async def load() -> None:
    people = await execute_query("SELECT email FROM users WHERE email_notifications = 0", fetch_all=True)
    rows = await execute_query("SELECT u.email, m.category FROM user_email_mutes m JOIN users u ON u.id = m.user_id", fetch_all=True)
    muted = {(p["email"] or "").lower() for p in (people or [])}
    modules: dict = {}
    for r in (rows or []):
        modules.setdefault((r["email"] or "").lower(), set()).add(r["category"])
    # Swap in place without an empty window: sender threads read these while we refresh
    _muted.intersection_update(muted); _muted.update(muted)
    for k in [k for k in _muted_modules if k not in modules]:
        _muted_modules.pop(k, None)
    _muted_modules.update(modules)


async def _refresh_loop() -> None:
    while True:
        try:
            await load()
        except Exception as e:
            logger.warning(f"Email settings refresh failed: {e}")
        await asyncio.sleep(REFRESH_SECONDS)


def start_refresh() -> None:
    asyncio.create_task(_refresh_loop())
