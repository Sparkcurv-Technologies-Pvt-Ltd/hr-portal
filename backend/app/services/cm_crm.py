"""Client Management — the Sales CRM, laid out like the team's Sales CRM workbook:

- **Leads** (``Lead ID, Company, Contact, Phone, Email, Location, Lead Source, Lead Status, Date Added, BDR, Converted?, Interested In / Notes, Next Action``).
  Every new prospect starts here; converting a lead finds or creates its **Account** and opens an **Opportunity**.
- **Accounts** are the ``clients`` table (one row per company; billing details live there for invoicing).
- **Opportunities** (stage dropdown Discovery → Demo Completed → Pricing/POC Discussion → Qualified → Closed Won / Closed Lost; deal value × stage probability = weighted value).
- **Follow-ups**: the 10-touch cadence per opportunity (Email 1 → Call 1 → … → Call 5), a date and an outcome for each touch.
- **Activity log**: every email / call / WhatsApp with its outcome. The overview and the daily BDR report count from it.

Sales-role people (BDRs) work only the rows they own; managers, viewers and admins see everyone's (``Ctx.sees_all_sales``).
"""

import io
import re
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException

from app.db import execute_query
from app.services import cm_core as core
from app.services.cm_core import D, F, Ctx


# ====================================================================== helpers

def scope(ctx: Ctx, alias: str, col: str = "owner_id") -> tuple:
    """Sales people only see their own rows; managers, viewers and admins see all."""
    if ctx.sees_all_sales:
        return "1=1", []
    if ctx.sales == "sales":
        return f"{alias}.{col} = %s", [ctx.uid]
    return "1=0", []

def _can_edit(ctx: Ctx, owner_id) -> bool:
    return ctx.sales == "mgr" or (ctx.sales == "sales" and owner_id == ctx.uid)

def _require_edit(ctx: Ctx, owner_id, what: str) -> None:
    if not _can_edit(ctx, owner_id):
        raise HTTPException(status_code=403, detail=f"You can only change {what} you own")

def _canon(value, allowed: tuple, default=None):
    """Case/space-insensitive match against a dropdown list; ``default`` when it isn't one of them."""
    v = (str(value) if value is not None else "").strip().lower()
    for a in allowed:
        if a.lower() == v:
            return a
    return default

def _text(value, limit: int = 0) -> Optional[str]:
    t = (str(value) if value is not None else "").strip()
    if len(t) > 1 and t[0] == "'" and t[1] in "=+-@":      # our CSV exports defuse spreadsheet formulas with a leading apostrophe; undo it on the way back in
        t = t[1:]
    t = "" if t in ("_", "__", "\\_\\_", "—", "-") else t
    return (t[:limit] if limit else t) or None

_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d-%b-%Y", "%d/%m/%Y", "%d-%B-%Y", "%Y/%m/%d", "%d.%m.%Y", "%d-%m-%y", "%m/%d/%Y")

def parse_date(value) -> Optional[str]:
    """The sheet mixes 2026-08-01, 02-09-2026, 25-Aug-2026 and 4-11-2026 (day first); anything unreadable is None."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    t = str(value).strip()
    t = t.split(" ")[0] if re.match(r"^\d{4}-\d{2}-\d{2} \d", t) else t
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt).date().isoformat()
        except ValueError:
            continue
    return None

def parse_money(value) -> Optional[float]:
    """'1,19,988' -> 119988; free text like 'core' -> None."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value) if value >= 0 else None
    t = re.sub(r"[,\s₹]|INR|Rs\.?", "", str(value), flags=re.I)
    try:
        n = float(t)
    except ValueError:
        return None
    return n if n >= 0 else None

def _need_date(value, label: str) -> Optional[str]:
    return core.clean_date(value, label) if value else None

async def resolve_user(label: Optional[str]) -> Optional[int]:
    """BDR / owner names from the sheet ('Anu', 'Wincy ') -> a user id: exact name, else a first-name match that is unique."""
    t = (label or "").strip().lower()
    if not t:
        return None
    rows = await execute_query("SELECT id, name FROM users WHERE LOWER(name) = %s", (t,), fetch_all=True)
    if len(rows or []) == 1:
        return rows[0]["id"]
    rows = await execute_query("SELECT id, name FROM users WHERE LOWER(name) LIKE %s", (t + " %",), fetch_all=True)
    return rows[0]["id"] if len(rows or []) == 1 else None

async def account_by_name(name: Optional[str]) -> Optional[dict]:
    n = (name or "").strip()
    return await execute_query("SELECT * FROM clients WHERE LOWER(name) = %s", (n.lower(),), fetch_one=True) if n else None

async def ensure_account(ctx: Ctx, name: str, **fields) -> tuple:
    """(account row, created?) — the company by name (case-insensitive), created as a Prospect when it doesn't exist."""
    acc = await account_by_name(name)
    if acc:
        return acc, False
    now = core.now_iso()
    cid = await execute_query(
        """INSERT INTO clients (code, name, email, phone, status, created_at, industry, location, website, account_type, owner_id, owner_label, contact_person, notes)
           VALUES (%s, %s, %s, %s, 'active', %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (core.temp_code(), name.strip()[:200], fields.get("email") or "", fields.get("phone") or "", fields.get("created_at") or now, fields.get("industry"), fields.get("location"),
         fields.get("website"), fields.get("account_type") or "Prospect", fields.get("owner_id"), fields.get("owner_label"), fields.get("contact_person"), fields.get("notes")), last_id=True)
    await execute_query("UPDATE clients SET code = %s WHERE id = %s", (core.format_code("A", cid), cid))
    return await core.client_or_404(cid), True

def bdr_of(r: dict) -> Optional[str]:
    return r.get("owner_name") or r.get("bdr_label")


# ====================================================================== leads

_LEAD_SELECT = "SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id"

def lead_out(r: dict) -> dict:
    return {"id": r["id"], "code": r["code"], "company_name": r["company_name"], "contact_person": r["contact_name"], "phone": r["phone"], "email": r["email"], "location": r.get("location"),
            "source": r["source"], "status": r.get("lead_status") or "New", "date_added": r.get("date_added"), "owner_id": r["owner_id"], "bdr": bdr_of(r),
            "converted": bool(r.get("converted_opp_id")), "converted_opp_id": r.get("converted_opp_id"), "interested_in": r.get("interested_in"), "next_action": r.get("next_action"),
            "client_id": r.get("client_id"), "created_at": r["created_at"], "updated_at": r["updated_at"]}

async def _lead_or_404(ctx: Ctx, lead_id: int) -> dict:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "l")
    r = await execute_query(_LEAD_SELECT + f" WHERE l.id = %s AND {sql}", (lead_id, *args), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Lead not found")
    return r

async def find_lead_duplicates(email: Optional[str], phone: Optional[str], exclude_id: Optional[int] = None) -> list:
    e, p = core.norm_email(email), core.norm_phone(phone)
    if not (e or p):
        return []
    rows = await execute_query(
        "SELECT l.id, l.code, l.company_name, l.contact_name, l.lead_status, l.owner_id, l.email_norm, l.phone_norm, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id "
        "WHERE ((%s IS NOT NULL AND l.email_norm = %s) OR (%s IS NOT NULL AND l.phone_norm = %s))" + (" AND l.id != %s" if exclude_id else ""),
        (e, e, p, p) + ((exclude_id,) if exclude_id else ()), fetch_all=True)
    return [{"id": r["id"], "code": r["code"], "name": r["company_name"] or r["contact_name"], "status": r["lead_status"], "owner_name": r["owner_name"],
             "matched_on": [k for k, hit in (("email", e and r["email_norm"] == e), ("phone", p and r["phone_norm"] == p)) if hit]} for r in (rows or [])]

def _lead_fields(data, partial: bool = False) -> dict:
    """Validated lead columns from a LeadIn / LeadUpdate (only the fields that were sent)."""
    sent = data.model_fields_set
    out = {}
    if "source" in sent and data.source is not None:
        out["source"] = core.check(data.source, core.LEAD_SOURCES, "lead source")
    if "status" in sent and data.status is not None:
        out["lead_status"] = core.check(data.status, core.LEAD_STATUSES, "lead status")
    if "date_added" in sent and data.date_added:
        out["date_added"] = core.clean_date(data.date_added, "Date added")
    for key, col, limit in (("company_name", "company_name", 200), ("contact_person", "contact_name", 200), ("phone", "phone", 40), ("location", "location", 200),
                            ("interested_in", "interested_in", 4000), ("next_action", "next_action", 500)):
        if key in sent:
            out[col] = _text(getattr(data, key), limit)
    if "email" in sent:
        e = (data.email or "").strip()
        if e and not core.valid_email(e):
            raise HTTPException(status_code=400, detail="That email address doesn't look right")
        out["email"] = e or None
    return out

async def create_lead(ctx: Ctx, data, *, source_note: Optional[str] = None) -> dict:
    core.require_sales_edit(ctx)
    f = _lead_fields(data)
    if not any([f.get("company_name"), f.get("contact_name"), f.get("email"), f.get("phone")]):
        raise HTTPException(status_code=400, detail="Enter at least a company, contact, email or phone")
    if f.get("lead_status") == "Converted":
        raise HTTPException(status_code=400, detail="A lead becomes Converted by converting it to an opportunity")
    owner = ctx.uid
    if data.owner_id is not None and data.owner_id != ctx.uid:
        core.require_manager(ctx)
        await core.user_or_400(data.owner_id, "BDR")
        owner = data.owner_id
    dups = await find_lead_duplicates(f.get("email"), f.get("phone"))
    if dups and not data.confirm_duplicate:
        raise HTTPException(status_code=409, detail={"message": "A lead with the same email or phone already exists", "duplicates": dups, "can_confirm": True})
    lid = await _insert_lead(f, owner, None, ctx.uid)
    return lead_out(await execute_query(_LEAD_SELECT + " WHERE l.id = %s", (lid,), fetch_one=True))

async def _insert_lead(f: dict, owner_id: Optional[int], bdr_label: Optional[str], created_by: Optional[int]) -> int:
    now = core.now_iso()
    lid = await execute_query(
        """INSERT INTO leads (code, source, company_name, contact_name, phone, email, phone_norm, email_norm, location, lead_status, date_added, interested_in, next_action,
                              owner_id, bdr_label, stage, created_by, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'NEW', %s, %s, %s)""",
        (core.temp_code(), f.get("source", "Other"), f.get("company_name"), f.get("contact_name"), f.get("phone"), f.get("email"), core.norm_phone(f.get("phone")), core.norm_email(f.get("email")),
         f.get("location"), f.get("lead_status", "New"), f.get("date_added") or core.today().isoformat(), f.get("interested_in"), f.get("next_action"), owner_id, bdr_label, created_by, now, now), last_id=True)
    await execute_query("UPDATE leads SET code = %s WHERE id = %s", (core.format_code("L", lid), lid))
    return lid

async def list_leads(ctx: Ctx, *, status: str = "", source: str = "", owner_id: int = 0, q: str = "", converted: Optional[bool] = None) -> list:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "l")
    where = [sql]
    if status:
        where.append("l.lead_status = %s"); args.append(core.check(status, core.LEAD_STATUSES, "lead status"))
    if source:
        where.append("l.source = %s"); args.append(core.check(source, core.LEAD_SOURCES, "lead source"))
    if owner_id:
        where.append("l.owner_id = %s"); args.append(owner_id)
    if converted is not None:
        where.append("l.converted_opp_id IS NOT NULL" if converted else "l.converted_opp_id IS NULL")
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(l.company_name LIKE %s OR l.contact_name LIKE %s OR l.phone LIKE %s OR l.email LIKE %s OR l.location LIKE %s OR l.interested_in LIKE %s)"); args += [like] * 6
    rows = await execute_query(_LEAD_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY l.id DESC LIMIT 5000", tuple(args), fetch_all=True)
    return [lead_out(r) for r in (rows or [])]

async def get_lead(ctx: Ctx, lead_id: int) -> dict:
    return lead_out(await _lead_or_404(ctx, lead_id))

async def update_lead(ctx: Ctx, lead_id: int, data) -> dict:
    lead = await _lead_or_404(ctx, lead_id)
    _require_edit(ctx, lead["owner_id"], "leads")
    f = _lead_fields(data)
    if "owner_id" in data.model_fields_set:
        if data.owner_id != lead["owner_id"]:
            core.require_manager(ctx)
        if data.owner_id is not None:
            await core.user_or_400(data.owner_id, "BDR")
        f["owner_id"] = data.owner_id
        f["bdr_label"] = None
    if lead["converted_opp_id"] and f.get("lead_status") not in (None, "Converted"):
        raise HTTPException(status_code=400, detail="This lead is converted — manage it on its opportunity")
    if f.get("lead_status") == "Converted":
        raise HTTPException(status_code=400, detail="A lead becomes Converted by converting it to an opportunity")
    if not f:
        raise HTTPException(status_code=400, detail="Nothing to update")
    for key, label in (("company_name", None), ("contact_name", None), ("email", None), ("phone", None)):
        pass
    if "email" in f or "phone" in f:
        f["email_norm"], f["phone_norm"] = core.norm_email(f.get("email", lead["email"])), core.norm_phone(f.get("phone", lead["phone"]))
    f["updated_at"] = core.now_iso()
    await execute_query(f"UPDATE leads SET {', '.join(f'{k} = %s' for k in f)} WHERE id = %s", (*f.values(), lead_id))
    return await get_lead(ctx, lead_id)

async def delete_lead(ctx: Ctx, lead_id: int) -> None:
    core.require_manager(ctx)
    lead = await _lead_or_404(ctx, lead_id)
    if lead["converted_opp_id"]:
        raise HTTPException(status_code=409, detail="This lead was converted to an opportunity — it can't be deleted")
    await execute_query("DELETE FROM leads WHERE id = %s", (lead_id,))

async def convert_lead(ctx: Ctx, lead_id: int, data) -> dict:
    """Convert a lead: its account is found by company name (or created), a Discovery opportunity opens, and the lead becomes Converted."""
    lead = await _lead_or_404(ctx, lead_id)
    _require_edit(ctx, lead["owner_id"], "leads")
    if lead["converted_opp_id"]:
        raise HTTPException(status_code=409, detail="This lead is already converted")
    if lead["lead_status"] == "Unqualified":
        raise HTTPException(status_code=400, detail="An unqualified lead can't be converted — change its status first")
    name = (lead["company_name"] or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Add the company name before converting — the account needs a name")
    if data.industry:
        core.check(data.industry, core.INDUSTRIES, "industry")
    acc, created = await ensure_account(ctx, name, email=lead["email"], phone=lead["phone"], location=lead.get("location"), industry=data.industry, contact_person=lead["contact_name"],
                                        owner_id=lead["owner_id"] or ctx.uid, owner_label=lead.get("bdr_label"))
    today = core.today()
    opp = await _insert_opportunity(ctx, acc["id"], opp_name=(data.opp_name or f"{name} - {today.strftime('%b %y')}").strip(), contact_person=lead["contact_name"], stage="Discovery",
                                    deal_value=data.deal_value, expected_close_date=_need_date(data.expected_close_date, "Expected close date"), lead_source=lead["source"],
                                    owner_id=lead["owner_id"], bdr_label=lead.get("bdr_label"), lead_id=lead_id, next_action=data.next_action or lead.get("next_action"), notes=data.notes or lead.get("interested_in"))
    await execute_query("UPDATE leads SET lead_status = 'Converted', converted_opp_id = %s, client_id = %s, updated_at = %s WHERE id = %s", (opp["id"], acc["id"], core.now_iso(), lead_id))
    cadence = None
    if data.start_cadence and not await execute_query("SELECT id FROM followups WHERE opportunity_id = %s LIMIT 1", (opp["id"],), fetch_one=True):
        # automation: converting starts the follow-up cadence, with Email 1 due today (next working day)
        fu = await create_followup(ctx, type("FU", (), {"opportunity_id": opp["id"], "client_id": None, "company_name": None, "contact_person": None, "owner_id": None, "notes": None, "model_fields_set": set()})())
        await execute_query("INSERT INTO followup_steps (followup_id, step_no, step_date, outcome) VALUES (%s, 1, %s, 'Pending')", (fu["id"], next_workday(today).isoformat()))
        cadence = fu["id"]
    await core.log_activity(name, f"Lead {lead['code']} converted → opportunity {opp['code']}" + (f" (account {acc['code']} created)" if created else f" (account {acc['code']})"), activity_type="Note", outcome=None,
                            ctx=ctx, client_id=acc["id"], lead_id=lead_id, opportunity_id=opp["id"])
    return {"lead": await get_lead(ctx, lead_id), "opportunity": opp, "account_id": acc["id"], "account_created": created, "followup_id": cadence}


# ====================================================================== opportunities

_OPP_SELECT = ("SELECT o.*, c.name AS account_name, u.name AS owner_name, "
               "(SELECT COUNT(*) FROM proposals p WHERE p.opportunity_id = o.id) AS proposal_count, "
               "(SELECT k.id FROM contracts k WHERE k.opportunity_id = o.id OR k.proposal_id IN (SELECT id FROM proposals WHERE opportunity_id = o.id) ORDER BY k.id LIMIT 1) AS contract_id "
               "FROM opportunities o JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = o.owner_id")

def opp_out(r: dict) -> dict:
    prob = core.STAGE_PROBABILITY.get(r["stage"], 0)
    value = r["deal_value"]
    return {"id": r["id"], "code": r["code"], "client_id": r["client_id"], "account_name": r.get("account_name"), "opp_name": r["opp_name"], "contact_person": r["contact_person"], "stage": r["stage"],
            "deal_value": F(value) if value is not None else None, "probability": prob, "weighted_value": F(D(value) * prob / 100) if value is not None else 0.0,
            "expected_close_date": r["expected_close_date"], "lead_source": r["lead_source"], "owner_id": r["owner_id"], "bdr": bdr_of(r), "lead_id": r["lead_id"], "created_date": r["created_date"],
            "last_activity_date": r["last_activity_date"], "next_action": r["next_action"], "notes": r["notes"], "proposal_count": int(r.get("proposal_count") or 0), "contract_id": r.get("contract_id"),
            "closed_at": r["closed_at"], "created_at": r["created_at"], "updated_at": r["updated_at"]}

async def opportunity_or_404(ctx: Ctx, opp_id: int) -> dict:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "o")
    r = await execute_query(_OPP_SELECT + f" WHERE o.id = %s AND {sql}", (opp_id, *args), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return r

def require_opportunity_edit(ctx: Ctx, opp: dict) -> None:
    _require_edit(ctx, opp["owner_id"], "opportunities")

async def _insert_opportunity(ctx: Optional[Ctx], client_id: int, *, opp_name: str, contact_person=None, stage="Discovery", deal_value=None, expected_close_date=None, lead_source=None,
                              owner_id=None, bdr_label=None, lead_id=None, created_date=None, last_activity_date=None, next_action=None, notes=None) -> dict:
    now = core.now_iso()
    oid = await execute_query(
        """INSERT INTO opportunities (code, client_id, opp_name, contact_person, stage, deal_value, expected_close_date, lead_source, owner_id, bdr_label, lead_id, created_date,
                                      last_activity_date, next_action, notes, closed_at, created_by, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (core.temp_code(), client_id, opp_name[:255], _text(contact_person, 200), stage, deal_value, expected_close_date, lead_source, owner_id, bdr_label, lead_id,
         created_date or core.today().isoformat(), last_activity_date, _text(next_action, 500), notes, now if stage in ("Closed Won", "Closed Lost") else None, ctx.uid if ctx else None, now, now), last_id=True)
    await execute_query("UPDATE opportunities SET code = %s WHERE id = %s", (core.format_code("O", oid), oid))
    return opp_out(await execute_query(_OPP_SELECT + " WHERE o.id = %s", (oid,), fetch_one=True))

async def create_opportunity(ctx: Ctx, data) -> dict:
    core.require_sales_edit(ctx)
    stage = core.check(data.stage or "Discovery", core.OPP_STAGES, "stage")
    if stage == "Closed Won":
        raise HTTPException(status_code=400, detail="Open the opportunity first; mark it Closed Won once the deal is won")
    if data.client_id:
        acc = await core.client_or_404(data.client_id)
    elif (data.company_name or "").strip():
        acc, _ = await ensure_account(ctx, data.company_name, owner_id=ctx.uid)
    else:
        raise HTTPException(status_code=400, detail="Choose the account (or enter the company name)")
    owner = ctx.uid
    if data.owner_id is not None and data.owner_id != ctx.uid:
        core.require_manager(ctx)
        await core.user_or_400(data.owner_id, "BDR")
        owner = data.owner_id
    if data.lead_source:
        core.check(data.lead_source, core.LEAD_SOURCES, "lead source")
    value = None
    if data.deal_value is not None:
        if data.deal_value < 0:
            raise HTTPException(status_code=400, detail="Deal value can't be negative")
        value = D(data.deal_value)
    name = (data.opp_name or f"{acc['name']} - {core.today().strftime('%b %y')}").strip()
    return await _insert_opportunity(ctx, acc["id"], opp_name=name, contact_person=data.contact_person, stage=stage, deal_value=value, expected_close_date=_need_date(data.expected_close_date, "Expected close date"),
                                     lead_source=data.lead_source, owner_id=owner, next_action=data.next_action, notes=data.notes)

async def list_opportunities(ctx: Ctx, *, stage: str = "", owner_id: int = 0, client_id: int = 0, q: str = "", open_only: bool = False) -> list:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "o")
    where = [sql]
    if stage:
        where.append("o.stage = %s"); args.append(core.check(stage, core.OPP_STAGES, "stage"))
    if open_only:
        where.append("o.stage IN ('Discovery', 'Demo Completed', 'Pricing/POC Discussion', 'Qualified')")
    if owner_id:
        where.append("o.owner_id = %s"); args.append(owner_id)
    if client_id:
        where.append("o.client_id = %s"); args.append(client_id)
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(o.opp_name LIKE %s OR c.name LIKE %s OR o.contact_person LIKE %s OR o.next_action LIKE %s OR o.notes LIKE %s)"); args += [like] * 5
    rows = await execute_query(_OPP_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY o.id DESC LIMIT 5000", tuple(args), fetch_all=True)
    return [opp_out(r) for r in (rows or [])]

async def get_opportunity(ctx: Ctx, opp_id: int) -> dict:
    return opp_out(await opportunity_or_404(ctx, opp_id))

async def update_opportunity(ctx: Ctx, opp_id: int, data) -> dict:
    opp = await opportunity_or_404(ctx, opp_id)
    require_opportunity_edit(ctx, opp)
    sent = data.model_fields_set
    ch = {}
    if "opp_name" in sent:
        if not (data.opp_name or "").strip():
            raise HTTPException(status_code=400, detail="Opportunity name can't be empty")
        ch["opp_name"] = data.opp_name.strip()[:255]
    for key, limit in (("contact_person", 200), ("next_action", 500)):
        if key in sent:
            ch[key] = _text(getattr(data, key), limit)
    if "notes" in sent:
        ch["notes"] = data.notes
    if "expected_close_date" in sent:
        ch["expected_close_date"] = _need_date(data.expected_close_date, "Expected close date")
    if "lead_source" in sent:
        ch["lead_source"] = core.check(data.lead_source, core.LEAD_SOURCES, "lead source") if data.lead_source else None
    if "deal_value" in sent:
        if data.deal_value is not None and data.deal_value < 0:
            raise HTTPException(status_code=400, detail="Deal value can't be negative")
        ch["deal_value"] = D(data.deal_value) if data.deal_value is not None else None
    if "owner_id" in sent:
        if data.owner_id != opp["owner_id"]:
            core.require_manager(ctx)
        if data.owner_id is not None:
            await core.user_or_400(data.owner_id, "BDR")
        ch["owner_id"], ch["bdr_label"] = data.owner_id, None
    if "stage" in sent and data.stage != opp["stage"]:
        stage = core.check(data.stage, core.OPP_STAGES, "stage")
        value = ch.get("deal_value", opp["deal_value"])
        if opp["stage"] in ("Closed Won", "Closed Lost"):
            core.require_manager(ctx)                                    # reopening a closed deal
            if opp["stage"] == "Closed Won" and opp.get("contract_id"):
                raise HTTPException(status_code=400, detail="A contract exists for this deal, so it can't be reopened")
        if stage == "Closed Won" and (value is None or D(value) <= 0):
            raise HTTPException(status_code=400, detail="Enter the deal value before marking the opportunity Closed Won")
        ch["stage"] = stage
        ch["closed_at"] = core.now_iso() if stage in ("Closed Won", "Closed Lost") else None
    if not ch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    ch["updated_at"] = core.now_iso()
    await execute_query(f"UPDATE opportunities SET {', '.join(f'{k} = %s' for k in ch)} WHERE id = %s", (*ch.values(), opp_id))
    if ch.get("stage"):
        await core.log_activity(opp["account_name"], f"Opportunity {opp['code']}: {opp['stage']} → {ch['stage']}", activity_type="Note", outcome=None, ctx=ctx, client_id=opp["client_id"], opportunity_id=opp_id)
        if ch["stage"] == "Closed Won":
            await execute_query("UPDATE clients SET account_type = 'Active Client' WHERE id = %s AND account_type = 'Prospect'", (opp["client_id"],))
    return await get_opportunity(ctx, opp_id)

async def delete_opportunity(ctx: Ctx, opp_id: int) -> None:
    core.require_manager(ctx)
    opp = await opportunity_or_404(ctx, opp_id)
    if opp["proposal_count"] or opp.get("contract_id"):
        raise HTTPException(status_code=409, detail="This opportunity has proposals or a contract — close it as Lost instead of deleting it")
    await execute_query("DELETE FROM opportunities WHERE id = %s", (opp_id,))
    await execute_query("UPDATE leads SET converted_opp_id = NULL, lead_status = 'Qualified' WHERE converted_opp_id = %s", (opp_id,))


# ====================================================================== follow-up cadence

_FU_SELECT = ("SELECT f.*, u.name AS owner_name, o.stage AS opp_stage, o.opp_name AS opp_name FROM followups f LEFT JOIN users u ON u.id = f.owner_id LEFT JOIN opportunities o ON o.id = f.opportunity_id")

def next_workday(d: date) -> date:
    """Saturday / Sunday -> the following Monday (cadence touches are scheduled on working days)."""
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d

def current_step(steps: list) -> str:
    """The sheet's 'Current Step': the last touch that has an outcome; 'Sequence Complete' after Call 5; 'Not started' when nothing is logged."""
    done = [s for s in steps if s["outcome"] and s["outcome"] != "Pending"]
    if not done:
        return "Not started" if not any(s["date"] for s in steps) else steps[[i for i, s in enumerate(steps) if s["date"]][-1]]["label"] + " (scheduled)"
    last = done[-1]
    return "Sequence Complete" if last["step_no"] == len(core.CADENCE) else last["label"]

def _steps_of(rows: list) -> list:
    by_no = {r["step_no"]: r for r in rows}
    return [{"step_no": i + 1, "label": label, "date": (by_no.get(i + 1) or {}).get("step_date"), "outcome": (by_no.get(i + 1) or {}).get("outcome")} for i, label in enumerate(core.CADENCE)]

def followup_out(r: dict, step_rows: list) -> dict:
    steps = _steps_of(step_rows)
    return {"id": r["id"], "code": r["code"], "client_id": r["client_id"], "opportunity_id": r["opportunity_id"], "opportunity_stage": r.get("opp_stage"), "opportunity_name": r.get("opp_name"),
            "company_name": r["company_name"], "contact_person": r["contact_person"], "owner_id": r["owner_id"], "bdr": bdr_of(r), "notes": r["notes"], "steps": steps, "current_step": current_step(steps),
            "created_at": r["created_at"], "updated_at": r["updated_at"]}

async def _followup_or_404(ctx: Ctx, fid: int) -> dict:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "f")
    r = await execute_query(_FU_SELECT + f" WHERE f.id = %s AND {sql}", (fid, *args), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return r

async def get_followup(ctx: Ctx, fid: int) -> dict:
    r = await _followup_or_404(ctx, fid)
    return followup_out(r, await execute_query("SELECT * FROM followup_steps WHERE followup_id = %s", (fid,), fetch_all=True) or [])

async def list_followups(ctx: Ctx, *, owner_id: int = 0, q: str = "", opportunity_id: int = 0, client_id: int = 0) -> list:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "f")
    where = [sql]
    if owner_id:
        where.append("f.owner_id = %s"); args.append(owner_id)
    if opportunity_id:
        where.append("f.opportunity_id = %s"); args.append(opportunity_id)
    if client_id:
        where.append("f.client_id = %s"); args.append(client_id)
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(f.company_name LIKE %s OR f.contact_person LIKE %s OR f.notes LIKE %s)"); args += [like] * 3
    rows = await execute_query(_FU_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY f.id DESC LIMIT 3000", tuple(args), fetch_all=True) or []
    steps = {}
    if rows:
        ids = [r["id"] for r in rows]
        for st in (await execute_query(f"SELECT * FROM followup_steps WHERE followup_id IN ({', '.join(['%s'] * len(ids))})", tuple(ids), fetch_all=True) or []):
            steps.setdefault(st["followup_id"], []).append(st)
    return [followup_out(r, steps.get(r["id"], [])) for r in rows]

async def create_followup(ctx: Ctx, data) -> dict:
    core.require_sales_edit(ctx)
    opp = acc = None
    if data.opportunity_id:
        opp = await opportunity_or_404(ctx, data.opportunity_id)
        acc = await core.client_or_404(opp["client_id"])
    elif data.client_id:
        acc = await core.client_or_404(data.client_id)
    company = (acc["name"] if acc else (data.company_name or "")).strip()
    if not company:
        raise HTTPException(status_code=400, detail="Choose the opportunity or account (or enter the company name)")
    owner = ctx.uid
    if data.owner_id is not None and data.owner_id != ctx.uid:
        core.require_manager(ctx)
        await core.user_or_400(data.owner_id, "BDR")
        owner = data.owner_id
    elif opp and opp["owner_id"] and ctx.sales == "mgr" and data.owner_id is None:
        owner = opp["owner_id"]
    if opp and await execute_query("SELECT id FROM followups WHERE opportunity_id = %s LIMIT 1", (opp["id"],), fetch_one=True):
        raise HTTPException(status_code=409, detail="This opportunity already has a follow-up cadence")
    if not acc:
        acc = await account_by_name(company)
    now = core.now_iso()
    fid = await execute_query(
        "INSERT INTO followups (code, client_id, opportunity_id, company_name, contact_person, owner_id, notes, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (core.temp_code(), acc["id"] if acc else None, opp["id"] if opp else None, company[:255], _text(data.contact_person or (opp["contact_person"] if opp else None), 200), owner, data.notes, now, now), last_id=True)
    await execute_query("UPDATE followups SET code = %s WHERE id = %s", (core.format_code("F", fid), fid))
    return await get_followup(ctx, fid)

async def update_followup(ctx: Ctx, fid: int, data) -> dict:
    f = await _followup_or_404(ctx, fid)
    _require_edit(ctx, f["owner_id"], "follow-ups")
    sent, ch = data.model_fields_set, {}
    if "contact_person" in sent:
        ch["contact_person"] = _text(data.contact_person, 200)
    if "notes" in sent:
        ch["notes"] = data.notes
    if "owner_id" in sent:
        if data.owner_id != f["owner_id"]:
            core.require_manager(ctx)
        if data.owner_id is not None:
            await core.user_or_400(data.owner_id, "BDR")
        ch["owner_id"], ch["bdr_label"] = data.owner_id, None
    if not ch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    ch["updated_at"] = core.now_iso()
    await execute_query(f"UPDATE followups SET {', '.join(f'{k} = %s' for k in ch)} WHERE id = %s", (*ch.values(), fid))
    return await get_followup(ctx, fid)

async def delete_followup(ctx: Ctx, fid: int) -> None:
    f = await _followup_or_404(ctx, fid)
    _require_edit(ctx, f["owner_id"], "follow-ups")
    await execute_query("UPDATE activity_log SET followup_id = NULL, followup_step = NULL WHERE followup_id = %s", (fid,))
    await execute_query("DELETE FROM followup_steps WHERE followup_id = %s", (fid,))
    await execute_query("DELETE FROM followups WHERE id = %s", (fid,))

async def set_step(ctx: Ctx, fid: int, step_no: int, data) -> dict:
    """Fill (or clear) one touch of the cadence. A touch with an outcome also lands in the activity log (so the overview counts it)."""
    f = await _followup_or_404(ctx, fid)
    _require_edit(ctx, f["owner_id"], "follow-ups")
    if not 1 <= step_no <= len(core.CADENCE):
        raise HTTPException(status_code=400, detail=f"Step must be 1–{len(core.CADENCE)}")
    d = _need_date(data.date, "Date")
    outcome = core.check(data.outcome, core.FOLLOWUP_OUTCOMES, "outcome") if data.outcome else None
    label = core.CADENCE[step_no - 1]
    kind = "Email" if label.startswith("Email") else "Call"
    if not d and not outcome:
        await execute_query("DELETE FROM followup_steps WHERE followup_id = %s AND step_no = %s", (fid, step_no))
        await execute_query("DELETE FROM activity_log WHERE followup_id = %s AND followup_step = %s", (fid, step_no))
    else:
        if outcome and outcome != "Pending" and not d:
            d = core.today().isoformat()                               # an outcome with no date means "today"
        await execute_query("INSERT INTO followup_steps (followup_id, step_no, step_date, outcome) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE step_date = VALUES(step_date), outcome = VALUES(outcome)", (fid, step_no, d, outcome))
        existing = await execute_query("SELECT id FROM activity_log WHERE followup_id = %s AND followup_step = %s", (fid, step_no), fetch_one=True)
        if outcome in ("Completed", "No Response", "Skipped") and step_no < len(core.CADENCE):
            # automation: schedule the next touch (as Pending) unless it already has a date or an outcome
            nxt = await execute_query("SELECT step_date, outcome FROM followup_steps WHERE followup_id = %s AND step_no = %s", (fid, step_no + 1), fetch_one=True)
            if not nxt or (not nxt["step_date"] and not nxt["outcome"]):
                due = next_workday(date.fromisoformat(d) + timedelta(days=core.CADENCE_GAP_DAYS[step_no - 1]))
                await execute_query("INSERT INTO followup_steps (followup_id, step_no, step_date, outcome) VALUES (%s, %s, %s, 'Pending') ON DUPLICATE KEY UPDATE step_date = VALUES(step_date), outcome = VALUES(outcome)",
                                    (fid, step_no + 1, due.isoformat()))
        if outcome and outcome != "Pending":
            note = f"{label} — cadence step"
            if existing:
                await execute_query("UPDATE activity_log SET log_date = %s, outcome = %s, activity_type = %s WHERE id = %s", (d, outcome, kind, existing["id"]))
            else:                                                       # adopt an identical row already logged by hand (or imported) instead of counting the touch twice
                twin = await execute_query("SELECT id FROM activity_log WHERE followup_id IS NULL AND LOWER(company_name) = %s AND log_date = %s AND activity_type = %s ORDER BY id LIMIT 1",
                                           (f["company_name"].lower(), d, kind), fetch_one=True)
                if twin:
                    await execute_query("UPDATE activity_log SET followup_id = %s, followup_step = %s, outcome = %s WHERE id = %s", (fid, step_no, outcome, twin["id"]))
                else:
                    await core.log_activity(f["company_name"], note, activity_type=kind, outcome=outcome, ctx=ctx, owner_id=f["owner_id"], bdr_label=f.get("bdr_label"), client_id=f["client_id"],
                                            opportunity_id=f["opportunity_id"], followup_id=fid, followup_step=step_no, log_date=d)
            if f["opportunity_id"]:
                await execute_query("UPDATE opportunities SET last_activity_date = %s WHERE id = %s AND (last_activity_date IS NULL OR last_activity_date < %s)", (d, f["opportunity_id"], d))
        elif existing:
            await execute_query("DELETE FROM activity_log WHERE id = %s", (existing["id"],))
    await execute_query("UPDATE followups SET updated_at = %s WHERE id = %s", (core.now_iso(), fid))
    return await get_followup(ctx, fid)


# ====================================================================== activity log

_ACT_SELECT = "SELECT a.*, u.name AS owner_name FROM activity_log a LEFT JOIN users u ON u.id = a.owner_id"

def activity_out(r: dict) -> dict:
    return {"id": r["id"], "code": r["code"], "log_date": r["log_date"], "owner_id": r["owner_id"], "bdr": r.get("bdr_label") or r.get("owner_name"), "client_id": r["client_id"], "lead_id": r["lead_id"], "opportunity_id": r["opportunity_id"],
            "followup_id": r["followup_id"], "followup_step": r["followup_step"], "company_name": r["company_name"], "activity_type": r["activity_type"], "outcome": r["outcome"], "notes": r["notes"],
            "from_cadence": r["followup_id"] is not None, "created_at": r["created_at"]}

async def list_activities(ctx: Ctx, *, date_from: str = "", date_to: str = "", owner_id: int = 0, activity_type: str = "", q: str = "", client_id: int = 0, opportunity_id: int = 0, lead_id: int = 0,
                          include_notes: bool = True, limit: int = 3000) -> list:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "a")
    where = [sql]
    if date_from:
        where.append("a.log_date >= %s"); args.append(core.clean_date(date_from, "From"))
    if date_to:
        where.append("a.log_date <= %s"); args.append(core.clean_date(date_to, "To"))
    if owner_id:
        where.append("a.owner_id = %s"); args.append(owner_id)
    if activity_type:
        where.append("a.activity_type = %s"); args.append(core.check(activity_type, core.ACTIVITY_TYPES, "activity type"))
    elif not include_notes:
        where.append("a.activity_type != 'Note'")
    for col, val in (("a.client_id", client_id), ("a.opportunity_id", opportunity_id), ("a.lead_id", lead_id)):
        if val:
            where.append(f"{col} = %s"); args.append(val)
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(a.company_name LIKE %s OR a.notes LIKE %s)"); args += [like, like]
    rows = await execute_query(_ACT_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY a.log_date DESC, a.id DESC LIMIT %s", (*args, max(1, min(limit, 10000))), fetch_all=True)
    return [activity_out(r) for r in (rows or [])]

async def create_activity(ctx: Ctx, data) -> dict:
    core.require_sales_edit(ctx)
    kind = core.check(data.activity_type, core.ACTIVITY_TYPES, "activity type")
    outcome = core.check(data.outcome, core.FOLLOWUP_OUTCOMES, "outcome") if data.outcome else None
    acc = await core.client_or_404(data.client_id) if data.client_id else await account_by_name(data.company_name)
    company = (acc["name"] if acc else (data.company_name or "")).strip()
    if not company:
        raise HTTPException(status_code=400, detail="Enter the company this activity was with")
    owner = ctx.uid
    if data.owner_id is not None and data.owner_id != ctx.uid:
        core.require_manager(ctx)
        owner = (await core.user_or_400(data.owner_id, "BDR"))["id"]
    d = core.clean_date(data.log_date, "Date") or core.today().isoformat()
    owner_row = await execute_query("SELECT name FROM users WHERE id = %s", (owner,), fetch_one=True)
    aid = await core.log_activity(company, (data.notes or "").strip(), activity_type=kind, outcome=outcome, ctx=ctx, owner_id=owner, bdr_label=owner_row["name"] if owner_row else None,
                                  client_id=acc["id"] if acc else None, log_date=d)
    if acc:
        await execute_query("UPDATE opportunities SET last_activity_date = %s WHERE client_id = %s AND stage IN ('Discovery', 'Demo Completed', 'Pricing/POC Discussion', 'Qualified') AND (last_activity_date IS NULL OR last_activity_date < %s)", (d, acc["id"], d))
    return activity_out(await execute_query(_ACT_SELECT + " WHERE a.id = %s", (aid,), fetch_one=True))

async def _activity_or_404(ctx: Ctx, aid: int) -> dict:
    core.require_sales_read(ctx)
    sql, args = scope(ctx, "a")
    r = await execute_query(_ACT_SELECT + f" WHERE a.id = %s AND {sql}", (aid, *args), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Activity not found")
    return r

async def update_activity(ctx: Ctx, aid: int, data) -> dict:
    a = await _activity_or_404(ctx, aid)
    _require_edit(ctx, a["owner_id"], "activity")
    if a["followup_id"]:
        raise HTTPException(status_code=400, detail="This touch comes from a follow-up cadence — change it on the Follow-ups screen")
    sent, ch = data.model_fields_set, {}
    if "log_date" in sent:
        ch["log_date"] = core.clean_date(data.log_date, "Date") or a["log_date"]
    if "activity_type" in sent:
        ch["activity_type"] = core.check(data.activity_type, core.ACTIVITY_TYPES, "activity type")
    if "outcome" in sent:
        ch["outcome"] = core.check(data.outcome, core.FOLLOWUP_OUTCOMES, "outcome") if data.outcome else None
    if "notes" in sent:
        ch["notes"] = (data.notes or "")[:4000]
    if "company_name" in sent:
        if not (data.company_name or "").strip():
            raise HTTPException(status_code=400, detail="Company can't be empty")
        acc = await account_by_name(data.company_name)
        ch["company_name"], ch["client_id"] = (acc["name"] if acc else data.company_name.strip()[:255]), (acc["id"] if acc else None)
    if "owner_id" in sent:
        if data.owner_id != a["owner_id"]:
            core.require_manager(ctx)
        if data.owner_id is not None:
            await core.user_or_400(data.owner_id, "BDR")
        ch["owner_id"], ch["bdr_label"] = data.owner_id, None
    if not ch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await execute_query(f"UPDATE activity_log SET {', '.join(f'{k} = %s' for k in ch)} WHERE id = %s", (*ch.values(), aid))
    return activity_out(await execute_query(_ACT_SELECT + " WHERE a.id = %s", (aid,), fetch_one=True))

async def delete_activity(ctx: Ctx, aid: int) -> None:
    a = await _activity_or_404(ctx, aid)
    _require_edit(ctx, a["owner_id"], "activity")
    if a["followup_id"]:
        raise HTTPException(status_code=400, detail="This touch comes from a follow-up cadence — clear it on the Follow-ups screen")
    await execute_query("DELETE FROM activity_log WHERE id = %s", (aid,))


# ====================================================================== overview (the sheet's dashboard)

async def overview(ctx: Ctx, owner_id: int = 0) -> dict:
    """Total Leads, Open Opportunities, Pipeline Value, Closed Won, Win Rate, Total Accounts, Emails / Calls today; pipeline by stage, leads by source and status, BDR activity today.
    ``owner_id`` narrows everything to one BDR (the sheet keeps a copy of the workbook per BDR)."""
    core.require_sales_read(ctx)
    ls, la = scope(ctx, "l")
    os_, oa = scope(ctx, "o")
    as_, aa = scope(ctx, "a")
    if owner_id:
        ls += " AND l.owner_id = %s"; la = [*la, owner_id]
        os_ += " AND o.owner_id = %s"; oa = [*oa, owner_id]
        as_ += " AND a.owner_id = %s"; aa = [*aa, owner_id]
    today = core.today().isoformat()
    n = lambda r: int(r["n"]) if r and r["n"] is not None else 0
    total_leads = n(await execute_query(f"SELECT COUNT(*) AS n FROM leads l WHERE {ls}", tuple(la), fetch_one=True))
    by_status = {r["s"]: int(r["n"]) for r in (await execute_query(f"SELECT l.lead_status AS s, COUNT(*) AS n FROM leads l WHERE {ls} GROUP BY l.lead_status", tuple(la), fetch_all=True) or [])}
    by_source = {r["s"]: int(r["n"]) for r in (await execute_query(f"SELECT l.source AS s, COUNT(*) AS n FROM leads l WHERE {ls} GROUP BY l.source", tuple(la), fetch_all=True) or [])}
    stage_rows = {r["s"]: r for r in (await execute_query(f"SELECT o.stage AS s, COUNT(*) AS n, COALESCE(SUM(o.deal_value), 0) AS v FROM opportunities o WHERE {os_} GROUP BY o.stage", tuple(oa), fetch_all=True) or [])}
    pipeline = [{"stage": st, "count": int(stage_rows[st]["n"]) if st in stage_rows else 0, "value": F(stage_rows[st]["v"]) if st in stage_rows else 0.0,
                 "weighted": F(D(stage_rows[st]["v"]) * core.STAGE_PROBABILITY[st] / 100) if st in stage_rows else 0.0} for st in core.OPP_STAGES]
    open_rows = [p for p in pipeline if p["stage"] in core.OPEN_OPP_STAGES]
    won, lost = (pipeline[4]["count"], pipeline[5]["count"])
    total_accounts = n(await execute_query("SELECT COUNT(*) AS n FROM clients" if not owner_id else "SELECT COUNT(*) AS n FROM clients WHERE owner_id = %s", (owner_id,) if owner_id else (), fetch_one=True))
    emails = n(await execute_query(f"SELECT COUNT(*) AS n FROM activity_log a WHERE {as_} AND a.log_date = %s AND a.activity_type = 'Email' AND a.outcome = 'Completed'", (*aa, today), fetch_one=True))
    calls = n(await execute_query(f"SELECT COUNT(*) AS n FROM activity_log a WHERE {as_} AND a.log_date = %s AND a.activity_type = 'Call' AND a.outcome = 'Completed'", (*aa, today), fetch_one=True))
    bdr = await execute_query(
        f"SELECT COALESCE(u.name, a.bdr_label, 'Unassigned') AS who, SUM(a.activity_type = 'Email' AND a.outcome = 'Completed') AS emails, SUM(a.activity_type = 'Call' AND a.outcome = 'Completed') AS calls "
        f"FROM activity_log a LEFT JOIN users u ON u.id = a.owner_id WHERE {as_} AND a.log_date = %s GROUP BY who ORDER BY who", (*aa, today), fetch_all=True)
    trend_from = (core.today() - timedelta(days=13)).isoformat()
    trend_rows = {r["d"]: r for r in (await execute_query(
        f"SELECT a.log_date AS d, SUM(a.activity_type = 'Email') AS e, SUM(a.activity_type = 'Call') AS c, SUM(a.activity_type = 'WhatsApp') AS w FROM activity_log a "
        f"WHERE {as_} AND a.log_date >= %s AND a.outcome = 'Completed' GROUP BY a.log_date", (*aa, trend_from), fetch_all=True) or [])}
    activity_14d = []
    for i in range(14):
        dd = (core.today() - timedelta(days=13 - i)).isoformat()
        r = trend_rows.get(dd)
        activity_14d.append({"date": dd, "emails": int(r["e"] or 0) if r else 0, "calls": int(r["c"] or 0) if r else 0, "whatsapp": int(r["w"] or 0) if r else 0})
    fsql, fargs = scope(ctx, "f")
    if owner_id:
        fsql += " AND f.owner_id = %s"; fargs = [*fargs, owner_id]
    due_followups = n(await execute_query(f"SELECT COUNT(*) AS n FROM followup_steps s JOIN followups f ON f.id = s.followup_id WHERE {fsql} AND s.step_date IS NOT NULL AND s.step_date <= %s "
                                          "AND (s.outcome IS NULL OR s.outcome IN ('Pending', 'Rescheduled'))", (*fargs, today), fetch_one=True))
    return {"as_of": today, "owner_id": owner_id or None, "activity_14d": activity_14d, "due_followups": due_followups, "total_leads": total_leads, "open_opportunities": sum(p["count"] for p in open_rows), "pipeline_value": F(sum((D(p["value"]) for p in open_rows), D(0))),
            "weighted_pipeline": F(sum((D(p["weighted"]) for p in open_rows), D(0))), "closed_won_value": pipeline[4]["value"], "closed_won_count": won,
            "win_rate_pct": round(won * 100 / (won + lost), 1) if (won + lost) else None, "total_accounts": total_accounts, "emails_today": emails, "calls_today": calls,
            "pipeline_by_stage": pipeline, "leads_by_source": [{"source": s, "count": by_source.get(s, 0)} for s in core.LEAD_SOURCES],
            "lead_status": [{"status": s, "count": by_status.get(s, 0)} for s in core.LEAD_STATUSES],
            "bdr_activity_today": [{"bdr": r["who"], "emails": int(r["emails"] or 0), "calls": int(r["calls"] or 0)} for r in (bdr or [])]}


async def badges(ctx: Ctx, owner_id: int = 0) -> dict:
    """Small numbers for the sheet tabs: follow-up touches due, leads still New, opportunities with no activity for two weeks."""
    core.require_sales_read(ctx)
    ov = await overview(ctx, owner_id)
    return {"due_followups": ov["due_followups"], "new_leads": next((s["count"] for s in ov["lead_status"] if s["status"] == "New"), 0)}

def lists() -> dict:
    """The sheet's "Lists" tab: every dropdown and the stage -> probability table."""
    return {"lead_sources": list(core.LEAD_SOURCES), "lead_statuses": list(core.LEAD_STATUSES), "industries": list(core.INDUSTRIES), "opportunity_stages": [{"stage": s, "probability": core.STAGE_PROBABILITY[s]} for s in core.OPP_STAGES],
            "account_types": list(core.ACCOUNT_TYPES), "followup_outcomes": list(core.FOLLOWUP_OUTCOMES), "activity_types": list(core.ACTIVITY_TYPES[:3]), "cadence": list(core.CADENCE), "cadence_gap_days": list(core.CADENCE_GAP_DAYS)}
