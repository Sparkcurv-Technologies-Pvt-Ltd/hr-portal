"""Public lead-capture web form: a link anyone can open (no login) to send their details; each submission becomes a NEW lead (source WEBSITE, unassigned)
or, when the email / phone already belongs to a lead, a note on that lead. Abuse guards: a hidden honeypot field, field limits, and a per-address rate limit."""

import time
from collections import defaultdict, deque

from fastapi import HTTPException

from app.db import execute_query
from app.services import cm_core as core
from app.services.cm_crm import _insert_lead, find_lead_duplicates

RATE_LIMIT = 5              # submissions ...
RATE_WINDOW_SECONDS = 600   # ... per address in this many seconds
_hits: dict = defaultdict(deque)
THANKS = "Thank you — we've received your details and will be in touch soon."


def _rate_limited(who: str) -> bool:
    now = time.monotonic()
    q = _hits[who]
    while q and now - q[0] > RATE_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    if len(_hits) > 5000:                       # keep the table small
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > RATE_WINDOW_SECONDS]:
            _hits.pop(k, None)
    return False


def _clean(value, limit: int) -> str:
    return " ".join((value or "").split())[:limit]


async def submit(data, who: str) -> dict:
    """``data``: name, company, email, phone, message, website (honeypot — real people leave it empty)."""
    if (data.website or "").strip():
        return {"message": THANKS}              # a bot: look successful, store nothing
    if _rate_limited(who):
        raise HTTPException(status_code=429, detail="Too many submissions from your connection. Please try again in a few minutes.")
    name, company, email, phone = _clean(data.name, 200), _clean(data.company, 200), _clean(data.email, 255), _clean(data.phone, 40)
    message = (data.message or "").strip()[:2000]
    if not name:
        raise HTTPException(status_code=400, detail="Please enter your name")
    if not (email or core.norm_phone(phone)):
        raise HTTPException(status_code=400, detail="Please enter an email address or a phone number we can reach you on")
    if email and not core.valid_email(email):
        raise HTTPException(status_code=400, detail="That email address doesn't look right")
    note = f"Web form: {name}" + (f" ({company})" if company else "") + (f" — {message}" if message else "")
    dups = await find_lead_duplicates(email, phone)
    if dups:                                    # known contact: add to their lead instead of creating a second one
        await core.log_activity(company or name, note, activity_type="Note", outcome=None, by_name="Web form", lead_id=dups[0]["id"])
        await execute_query("UPDATE leads SET updated_at = %s WHERE id = %s", (core.now_iso(), dups[0]["id"]))
        return {"message": THANKS}
    fields = {"source": "Website", "lead_status": "New", "company_name": company or None, "contact_name": name, "phone": phone or None, "email": email or None, "interested_in": message or None}
    lid = await _insert_lead(fields, None, "Web form", None)
    await core.log_activity(company or name, "Lead created from the web form" + (f" — {message}" if message else ""), activity_type="Note", outcome=None, by_name="Web form", lead_id=lid)
    return {"message": THANKS}


def form_link(base: str) -> dict:
    url = f"{base.rstrip('/')}/api/public/lead-form"
    return {"url": url, "embed": f'<iframe src="{url}" title="Contact us" style="width:100%;max-width:560px;height:620px;border:0"></iframe>'}
