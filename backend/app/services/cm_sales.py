"""Client Management — sales side: clients, leads, tenders, proposals (items, files, send, review, PDF, public reply), contracts, engagements.

Workflow: lead → qualify → (tender) → proposal → sent → review → PO won → contract → engagement.
Access levels and the rules each step enforces are described in ``cm_core``.
"""

import asyncio
import re
from typing import Optional

import pymysql
from fastapi import HTTPException

from app.core.config import FRONTEND_URL, PUBLIC_API_URL
from app.core.email import _proposal_email_html, _proposal_reply_email_html, _send_email, _send_email_with_pdf
from app.db import execute_query
from app.services import cm_core as core
from app.services.cm_core import D, F, Ctx
from app.services.proposal_pdf import generate_proposal_pdf

COMPANY_NAME = "Sparkcurv"
FILE_TYPES = {"pdf": "application/pdf", "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}


# ====================================================================== clients

def client_out(r: dict) -> dict:
    return {"id": r["id"], "code": r["code"], "name": r["name"], "gstin": r["gstin"], "billing_address": r["billing_address"] or r["address"], "contact_person": r["contact_person"],
            "phone": r["phone"], "email": r["email"], "default_tds_pct": float(r["default_tds_pct"] or 0), "default_retention_pct": float(r["default_retention_pct"] or 0),
            "is_active": r["status"] == "active", "created_at": r["created_at"]}

def _clean_gstin(g: Optional[str]) -> Optional[str]:
    g = (g or "").strip().upper()
    if not g:
        return None
    if not re.fullmatch(r"[A-Z0-9\-]{5,20}", g):
        raise HTTPException(status_code=400, detail="GSTIN / tax id must be 5–20 letters, digits or dashes")
    return g

async def find_client_duplicates(name: Optional[str], gstin: Optional[str], exclude_id: Optional[int] = None) -> list:
    rows = await execute_query(
        "SELECT id, code, name, gstin FROM clients WHERE ((%s IS NOT NULL AND LOWER(name) = LOWER(%s)) OR (%s IS NOT NULL AND gstin = %s))" + (" AND id != %s" if exclude_id else ""),
        (name, name, gstin, gstin) + ((exclude_id,) if exclude_id else ()), fetch_all=True)
    return [{"id": r["id"], "code": r["code"], "name": r["name"], "matched_on": [k for k, hit in (("name", name and r["name"].lower() == name.lower()), ("gstin", gstin and r["gstin"] == gstin)) if hit]} for r in (rows or [])]

async def create_client(ctx: Ctx, data) -> dict:
    core.require_sales_edit(ctx)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Client name is required")
    gstin = _clean_gstin(data.gstin)
    tds, ret = core.check_pct(data.default_tds_pct, "Default TDS %"), core.check_pct(data.default_retention_pct, "Default retention %")
    dups = await find_client_duplicates(name, gstin)
    same_name = [d for d in dups if "name" in d["matched_on"]]
    if same_name or (dups and not data.confirm_duplicate):
        # a client with this name can't exist twice (it is unique); a shared GSTIN can be confirmed
        raise HTTPException(status_code=409, detail={"message": "A client with the same name or GSTIN already exists", "duplicates": dups, "can_confirm": not same_name})
    cid = await execute_query(
        """INSERT INTO clients (code, name, gstin, billing_address, address, contact_person, phone, email, default_tds_pct, default_retention_pct, status, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (core.temp_code(), name[:200], gstin, data.billing_address, data.billing_address, data.contact_person, (data.phone or "").strip(), (data.email or "").strip(), tds, ret,
         "active" if data.is_active else "inactive", core.now_iso()), last_id=True)
    await execute_query("UPDATE clients SET code = %s WHERE id = %s", (core.format_code("CLI", cid), cid))
    return client_out(await core.client_or_404(cid))

async def update_client(ctx: Ctx, client_id: int, data) -> dict:
    core.require_sales_edit(ctx)
    cur = await core.client_or_404(client_id)
    changes = {k: v for k, v in data.model_dump().items() if k in data.model_fields_set}
    if "name" in changes:
        changes["name"] = (changes["name"] or "").strip()
        if not changes["name"]:
            raise HTTPException(status_code=400, detail="Client name can't be empty")
    if "gstin" in changes:
        changes["gstin"] = _clean_gstin(changes["gstin"])
    for k, label in (("default_tds_pct", "Default TDS %"), ("default_retention_pct", "Default retention %")):
        if k in changes:
            changes[k] = core.check_pct(changes[k], label)
    if "is_active" in changes:
        changes["status"] = "active" if changes.pop("is_active") else "inactive"
    if "billing_address" in changes:
        changes["address"] = changes["billing_address"]
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "name" in changes or "gstin" in changes:
        dups = await find_client_duplicates(changes.get("name", cur["name"]), changes.get("gstin", cur["gstin"]), exclude_id=client_id)
        if dups:
            raise HTTPException(status_code=409, detail={"message": "Another client already has this name or GSTIN", "duplicates": dups, "can_confirm": False})
    await execute_query(f"UPDATE clients SET {', '.join(f'{k} = %s' for k in changes)} WHERE id = %s", (*changes.values(), client_id))
    return client_out(await core.client_or_404(client_id))

async def list_clients(ctx: Ctx, q: str = "", active: Optional[bool] = None) -> list:
    core.require_any(ctx)
    where, args = [], []
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(name LIKE %s OR code LIKE %s OR gstin LIKE %s)"); args += [like, like, like]
    if active is not None:
        where.append("status = %s"); args.append("active" if active else "inactive")
    rows = await execute_query("SELECT * FROM clients" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY name", tuple(args), fetch_all=True)
    return [client_out(r) for r in (rows or [])]

async def get_client(ctx: Ctx, client_id: int) -> dict:
    core.require_any(ctx)
    return client_out(await core.client_or_404(client_id))

async def delete_client(ctx: Ctx, client_id: int) -> None:
    core.require_manager(ctx)
    await core.client_or_404(client_id)
    for table in ("leads", "contracts", "proposals", "invoices", "client_payments", "client_advances"):
        if await execute_query(f"SELECT id FROM {table} WHERE client_id = %s LIMIT 1", (client_id,), fetch_one=True):
            raise HTTPException(status_code=409, detail="This client has history — mark it inactive instead of deleting it")
    await execute_query("DELETE FROM clients WHERE id = %s", (client_id,))


# ====================================================================== leads

def lead_out(r: dict) -> dict:
    today = core.today().isoformat()
    return {"id": r["id"], "code": r["code"], "source": r["source"], "client_id": r["client_id"], "client_name": r.get("client_name"), "company_name": r["company_name"],
            "contact_name": r["contact_name"], "phone": r["phone"], "email": r["email"], "estimated_value": F(r["estimated_value"]) if r["estimated_value"] is not None else None,
            "owner_id": r["owner_id"], "owner_name": r.get("owner_name"), "stage": r["stage"], "next_followup_at": r["next_followup_at"], "lost_reason": r["lost_reason"],
            "followup_overdue": bool(r["next_followup_at"] and r["next_followup_at"] <= today and r["stage"] in core.OPEN_LEAD_STAGES),
            "created_at": r["created_at"], "updated_at": r["updated_at"], "won_at": r["won_at"], "lost_at": r["lost_at"]}

_LEAD_SELECT = "SELECT l.*, c.name AS client_name, u.name AS owner_name FROM leads l LEFT JOIN clients c ON c.id = l.client_id LEFT JOIN users u ON u.id = l.owner_id"

def lead_scope(ctx: Ctx, alias: str = "l") -> tuple:
    """Sales people only see their own leads; managers, viewers and admins see all."""
    if ctx.sees_all_sales:
        return "1=1", []
    if ctx.sales == "sales":
        return f"{alias}.owner_id = %s", [ctx.uid]
    return "1=0", []

async def _lead_or_404(ctx: Ctx, lead_id: int) -> dict:
    core.require_sales_read(ctx)
    scope, args = lead_scope(ctx)
    r = await execute_query(_LEAD_SELECT + f" WHERE l.id = %s AND {scope}", (lead_id, *args), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Lead not found")
    return r

def _require_lead_edit(ctx: Ctx, lead: dict) -> None:
    core.require_sales_edit(ctx)
    if not ctx.owns(lead["owner_id"]):
        raise HTTPException(status_code=403, detail="You can only work on leads you own")

def _validate_lead_fields(data, partial: bool = False) -> dict:
    out = {}
    if data.source is not None:
        out["source"] = core.check(data.source, core.LEAD_SOURCES, "source")
    if data.estimated_value is not None:
        if data.estimated_value < 0:
            raise HTTPException(status_code=400, detail="Estimated value can't be negative")
        out["estimated_value"] = D(data.estimated_value)
    if data.next_followup_at is not None:
        out["next_followup_at"] = core.clean_date(data.next_followup_at, "Follow-up date")
    if data.email:
        if not core.valid_email(data.email.strip()):
            raise HTTPException(status_code=400, detail="That email address doesn't look right")
    return out

async def find_lead_duplicates(email: Optional[str], phone: Optional[str], exclude_id: Optional[int] = None) -> list:
    e, p = core.norm_email(email), core.norm_phone(phone)
    if not (e or p):
        return []
    rows = await execute_query(
        "SELECT l.id, l.code, l.company_name, l.contact_name, l.stage, l.owner_id, l.email_norm, l.phone_norm, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id "
        "WHERE ((%s IS NOT NULL AND l.email_norm = %s) OR (%s IS NOT NULL AND l.phone_norm = %s))" + (" AND l.id != %s" if exclude_id else ""),
        (e, e, p, p) + ((exclude_id,) if exclude_id else ()), fetch_all=True)
    return [{"id": r["id"], "code": r["code"], "name": r["company_name"] or r["contact_name"], "stage": r["stage"], "owner_name": r["owner_name"],
             "matched_on": [k for k, hit in (("email", e and r["email_norm"] == e), ("phone", p and r["phone_norm"] == p)) if hit]} for r in (rows or [])]

async def _insert_lead(ctx: Ctx, data, owner_id: int) -> int:
    fields = _validate_lead_fields(data)
    e, p = core.norm_email(data.email), core.norm_phone(data.phone)
    if data.client_id is not None:
        await core.client_or_404(data.client_id)
    now = core.now_iso()
    lid = await execute_query(
        """INSERT INTO leads (code, source, client_id, company_name, contact_name, phone, email, phone_norm, email_norm, estimated_value, owner_id, stage, next_followup_at,
                              created_by, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'NEW', %s, %s, %s, %s)""",
        (core.temp_code(), fields.get("source", "OTHER"), data.client_id, (data.company_name or "").strip() or None, (data.contact_name or "").strip() or None,
         (data.phone or "").strip() or None, (data.email or "").strip() or None, p, e, fields.get("estimated_value"), owner_id, fields.get("next_followup_at"), ctx.uid, now, now), last_id=True)
    await execute_query("UPDATE leads SET code = %s WHERE id = %s", (core.format_code("LEAD", lid), lid))
    await core.log_activity(lid, "STAGE_CHANGE", "Lead created (NEW)" + (f" — {data.note}" if getattr(data, "note", None) else ""), ctx)
    return lid

async def create_lead(ctx: Ctx, data) -> dict:
    core.require_sales_edit(ctx)
    if not any([(data.company_name or "").strip(), (data.contact_name or "").strip(), (data.email or "").strip(), (data.phone or "").strip()]):
        raise HTTPException(status_code=400, detail="Enter at least a company, contact name, email or phone")
    owner = ctx.uid
    if data.owner_id is not None and data.owner_id != ctx.uid:
        core.require_manager(ctx)
        await core.user_or_400(data.owner_id, "Owner")
        owner = data.owner_id
    dups = await find_lead_duplicates(data.email, data.phone)
    if dups and not data.confirm_duplicate:
        raise HTTPException(status_code=409, detail={"message": "A lead with the same email or phone already exists", "duplicates": dups, "can_confirm": True})
    lid = await _insert_lead(ctx, data, owner)
    return lead_out(await execute_query(_LEAD_SELECT + " WHERE l.id = %s", (lid,), fetch_one=True))

async def import_leads(ctx: Ctx, rows: list, confirm_duplicate: bool = False) -> dict:
    """Bulk import. Each row is validated like a single create; rows that duplicate an existing lead (or an earlier row of the batch) are skipped and reported."""
    core.require_sales_edit(ctx)
    if not rows:
        raise HTTPException(status_code=400, detail="There are no rows to import")
    if len(rows) > 500:
        raise HTTPException(status_code=400, detail="Import at most 500 rows at a time")
    created, skipped, errors, seen_email, seen_phone = [], [], [], set(), set()
    for i, row in enumerate(rows, 1):
        try:
            if not any([(row.company_name or "").strip(), (row.contact_name or "").strip(), (row.email or "").strip(), (row.phone or "").strip()]):
                raise HTTPException(status_code=400, detail="Row is empty")
            owner = ctx.uid
            if row.owner_id is not None and row.owner_id != ctx.uid:
                core.require_manager(ctx); await core.user_or_400(row.owner_id, "Owner"); owner = row.owner_id
            e, p = core.norm_email(row.email), core.norm_phone(row.phone)
            dups = await find_lead_duplicates(row.email, row.phone)
            in_batch = (e and e in seen_email) or (p and p in seen_phone)
            if (dups or in_batch) and not (confirm_duplicate or row.confirm_duplicate):
                skipped.append({"row": i, "reason": "duplicate", "duplicates": dups or [{"matched_on": ["earlier row in this import"]}]})
                continue
            lid = await _insert_lead(ctx, row, owner)
            created.append({"row": i, "id": lid, "code": core.format_code("LEAD", lid)})
            e and seen_email.add(e); p and seen_phone.add(p)
        except HTTPException as ex:
            errors.append({"row": i, "error": ex.detail if isinstance(ex.detail, str) else str(ex.detail)})
    return {"created": created, "skipped_duplicates": skipped, "errors": errors, "summary": {"created": len(created), "skipped": len(skipped), "errors": len(errors)}}

async def list_leads(ctx: Ctx, *, stage: str = "", owner_id: int = 0, q: str = "", overdue: bool = False) -> list:
    core.require_sales_read(ctx)
    scope, args = lead_scope(ctx)
    where = [scope]
    if stage:
        where.append("l.stage = %s"); args.append(core.check(stage, core.LEAD_STAGES, "stage"))
    if owner_id and ctx.sees_all_sales:
        where.append("l.owner_id = %s"); args.append(owner_id)
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(l.code LIKE %s OR l.company_name LIKE %s OR l.contact_name LIKE %s OR l.email LIKE %s)"); args += [like, like, like, like]
    if overdue:
        where.append("l.next_followup_at IS NOT NULL AND l.next_followup_at <= %s AND l.stage IN ('NEW', 'CONTACTED', 'QUALIFIED', 'TENDER', 'PROPOSAL')"); args.append(core.today().isoformat())
    rows = await execute_query(_LEAD_SELECT + f" WHERE {' AND '.join(where)} ORDER BY l.next_followup_at IS NULL, l.next_followup_at, l.id DESC LIMIT 1000", tuple(args), fetch_all=True)
    return [lead_out(r) for r in (rows or [])]

async def get_lead(ctx: Ctx, lead_id: int) -> dict:
    return lead_out(await _lead_or_404(ctx, lead_id))

async def update_lead(ctx: Ctx, lead_id: int, data) -> dict:
    lead = await _lead_or_404(ctx, lead_id)
    _require_lead_edit(ctx, lead)
    if lead["stage"] in ("WON", "LOST"):
        raise HTTPException(status_code=400, detail=f"This lead is {lead['stage']} and can't be edited")
    changes = {k: v for k, v in data.model_dump().items() if k in data.model_fields_set}
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    fields = _validate_lead_fields(data)
    if "owner_id" in changes:
        core.require_manager(ctx); await core.user_or_400(changes["owner_id"], "Owner")
    if changes.get("client_id") is not None:
        await core.client_or_404(changes["client_id"])
    for k in ("company_name", "contact_name", "phone", "email"):
        if k in changes:
            changes[k] = (changes[k] or "").strip() or None
    changes.update({k: v for k, v in fields.items() if k in changes})
    if "email" in changes or "phone" in changes:
        e, p = core.norm_email(changes.get("email", lead["email"])), core.norm_phone(changes.get("phone", lead["phone"]))
        changes.update({"email_norm": e, "phone_norm": p})
    changes["updated_at"] = core.now_iso()
    await execute_query(f"UPDATE leads SET {', '.join(f'{k} = %s' for k in changes)} WHERE id = %s", (*changes.values(), lead_id))
    return await get_lead(ctx, lead_id)

async def list_activities(ctx: Ctx, lead_id: int) -> list:
    await _lead_or_404(ctx, lead_id)
    rows = await execute_query("SELECT * FROM lead_activities WHERE lead_id = %s ORDER BY id DESC", (lead_id,), fetch_all=True)
    return [dict(r) for r in (rows or [])]

async def add_activity(ctx: Ctx, lead_id: int, data) -> dict:
    lead = await _lead_or_404(ctx, lead_id)
    _require_lead_edit(ctx, lead)
    core.check(data.kind, ("CALL", "EMAIL", "MEETING", "NOTE"), "kind")
    if not (data.body or "").strip():
        raise HTTPException(status_code=400, detail="Write a short note")
    follow = core.clean_date(data.next_followup_at, "Follow-up date")
    await core.log_activity(lead_id, data.kind, data.body.strip(), ctx)
    if data.next_followup_at is not None:
        await execute_query("UPDATE leads SET next_followup_at = %s, updated_at = %s WHERE id = %s", (follow, core.now_iso(), lead_id))
    return {"activities": await list_activities(ctx, lead_id)}

async def _set_stage(ctx: Ctx, lead: dict, stage: str, note: str, extra: Optional[dict] = None) -> None:
    sets, args = ["stage = %s", "updated_at = %s"], [stage, core.now_iso()]
    for k, v in (extra or {}).items():
        sets.append(f"{k} = %s"); args.append(v)
    await execute_query(f"UPDATE leads SET {', '.join(sets)} WHERE id = %s", (*args, lead["id"]))
    await core.log_activity(lead["id"], "STAGE_CHANGE", f"{lead['stage']} → {stage}" + (f" — {note}" if note else ""), ctx)

async def move_stage(ctx: Ctx, lead_id: int, move) -> dict:
    """NEW ⇄ CONTACTED and → LOST here; QUALIFIED, TENDER, PROPOSAL and WON have their own actions (they enforce the rules)."""
    lead = await _lead_or_404(ctx, lead_id)
    _require_lead_edit(ctx, lead)
    target = core.check(move.stage, core.LEAD_STAGES, "stage")
    cur = lead["stage"]
    if target == cur:
        raise HTTPException(status_code=400, detail=f"The lead is already {cur}")
    if cur == "WON":
        raise HTTPException(status_code=400, detail="A won lead can't be moved")
    if cur == "LOST":
        if target != "NEW":
            raise HTTPException(status_code=400, detail="A lost lead can only be reopened as NEW")
        core.require_manager(ctx)
        await _set_stage(ctx, lead, "NEW", move.note, {"lost_reason": None, "lost_at": None})
    elif target == "LOST":
        if not (move.lost_reason or "").strip():
            raise HTTPException(status_code=400, detail="Losing a lead needs a reason")
        await _set_stage(ctx, lead, "LOST", move.note, {"lost_reason": move.lost_reason.strip()[:500], "lost_at": core.now_iso()})
    elif target in ("NEW", "CONTACTED") and cur in ("NEW", "CONTACTED"):
        await _set_stage(ctx, lead, target, move.note)
    elif target == "QUALIFIED":
        raise HTTPException(status_code=400, detail="Use the Qualify action — it checks the lead has a client, contact, phone or email and an estimated value")
    elif target == "TENDER":
        raise HTTPException(status_code=400, detail="Use the 'to tender' action")
    elif target == "PROPOSAL":
        raise HTTPException(status_code=400, detail="Use the 'to proposal' action")
    elif target == "WON":
        raise HTTPException(status_code=400, detail="A lead is won by booking the PO on a sent, approved proposal")
    else:
        raise HTTPException(status_code=400, detail=f"A lead can't go from {cur} to {target} here")
    return await get_lead(ctx, lead_id)

def missing_for_qualification(lead: dict, has_client: bool, can_create: bool) -> list:
    """Exactly what a lead still needs before it can be QUALIFIED."""
    missing = []
    if not has_client:
        missing.append("client (choose an existing client, or add a company name to create one)" if not can_create else "client")
    if not (lead["contact_name"] or "").strip():
        missing.append("contact name")
    if not ((lead["phone"] or "").strip() or (lead["email"] or "").strip()):
        missing.append("phone or email")
    if lead["estimated_value"] is None or D(lead["estimated_value"]) <= 0:
        missing.append("estimated value (greater than zero)")
    return missing

async def qualify(ctx: Ctx, lead_id: int, data) -> dict:
    lead = await _lead_or_404(ctx, lead_id)
    _require_lead_edit(ctx, lead)
    if lead["stage"] not in ("NEW", "CONTACTED"):
        raise HTTPException(status_code=400, detail=f"Only a NEW or CONTACTED lead can be qualified (this one is {lead['stage']})")
    client_id = data.client_id or lead["client_id"]
    if client_id:
        await core.client_or_404(client_id)
    can_create = bool(data.create_client and ((lead["company_name"] or "").strip() or (data.client and data.client.name.strip())))
    missing = missing_for_qualification(lead, bool(client_id) or can_create, bool(data.create_client))
    if missing:
        raise HTTPException(status_code=400, detail={"message": "This lead can't be qualified yet. Missing: " + ", ".join(missing), "missing": missing})
    created = None
    if not client_id:
        from app.schemas.client_mgmt import ClientIn
        spec = data.client or ClientIn(name=lead["company_name"])
        spec = spec.model_copy(update={"name": (spec.name or lead["company_name"]).strip(), "contact_person": spec.contact_person or lead["contact_name"],
                                       "phone": spec.phone or lead["phone"], "email": spec.email or lead["email"]})
        created = await create_client(ctx, spec)
        client_id = created["id"]
    await execute_query("UPDATE leads SET client_id = %s WHERE id = %s", (client_id, lead_id))
    await _set_stage(ctx, lead, "QUALIFIED", data.note + (f" (client {created['code']} created)" if created else ""))
    return await get_lead(ctx, lead_id)


# ====================================================================== tenders

def tender_out(r: dict) -> dict:
    return {k: r[k] for k in ("id", "lead_id", "reference", "due_date", "status", "notes", "created_at")}

async def to_tender(ctx: Ctx, lead_id: int, data) -> dict:
    lead = await _lead_or_404(ctx, lead_id)
    _require_lead_edit(ctx, lead)
    if lead["stage"] != "QUALIFIED":
        raise HTTPException(status_code=400, detail=f"Only a QUALIFIED lead can go to tender (this one is {lead['stage']})")
    tid = await execute_query("INSERT INTO tenders (lead_id, reference, due_date, status, notes, created_by, created_at) VALUES (%s, %s, %s, 'OPEN', %s, %s, %s)",
                              (lead_id, data.reference, core.clean_date(data.due_date, "Due date"), data.notes, ctx.uid, core.now_iso()), last_id=True)
    await _set_stage(ctx, lead, "TENDER", f"Tender {data.reference or tid} opened")
    return tender_out(await execute_query("SELECT * FROM tenders WHERE id = %s", (tid,), fetch_one=True))

async def list_tenders(ctx: Ctx, lead_id: int) -> list:
    await _lead_or_404(ctx, lead_id)
    return [tender_out(r) for r in (await execute_query("SELECT * FROM tenders WHERE lead_id = %s ORDER BY id DESC", (lead_id,), fetch_all=True) or [])]

async def update_tender(ctx: Ctx, tender_id: int, data) -> dict:
    t = await execute_query("SELECT * FROM tenders WHERE id = %s", (tender_id,), fetch_one=True)
    if not t:
        raise HTTPException(status_code=404, detail="Tender not found")
    lead = await _lead_or_404(ctx, t["lead_id"])
    _require_lead_edit(ctx, lead)
    changes = {k: v for k, v in data.model_dump().items() if k in data.model_fields_set}
    if "status" in changes:
        core.check(changes["status"], core.TENDER_STATUSES, "status")
        if changes["status"] == "WON":
            raise HTTPException(status_code=400, detail="A tender is won by booking the PO on the proposal")
    if "due_date" in changes:
        changes["due_date"] = core.clean_date(changes["due_date"], "Due date")
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await execute_query(f"UPDATE tenders SET {', '.join(f'{k} = %s' for k in changes)} WHERE id = %s", (*changes.values(), tender_id))
    if "status" in changes:
        await core.log_activity(t["lead_id"], "NOTE", f"Tender {t['reference'] or tender_id}: {t['status']} → {changes['status']}", ctx)
    return tender_out(await execute_query("SELECT * FROM tenders WHERE id = %s", (tender_id,), fetch_one=True))


# ====================================================================== proposals

def _items_out(rows: list, with_cost: bool) -> list:
    out = []
    for r in rows:
        item = {"id": r["id"], "line_no": r["line_no"], "description": r["description"], "quantity": float(r["quantity"]), "unit": r["unit"], "rate": float(r["rate"]),
                "amount": F(D(r["quantity"]) * D(r["rate"]))}
        if with_cost:
            item.update({"cost": float(r["cost"]), "below_cost": D(r["rate"]) < D(r["cost"])})
        out.append(item)
    return out

def proposal_out(r: dict, items: Optional[list] = None, ctx: Optional[Ctx] = None) -> dict:
    out = {"id": r["id"], "code": r["code"], "lead_id": r["lead_id"], "tender_id": r["tender_id"], "client_id": r["client_id"], "client_name": r.get("client_name"), "title": r["title"],
           "status": r["status"], "review_status": r["review_status"], "review_note": r["review_note"], "reviewed_at": r["reviewed_at"], "total_amount": F(r["total_amount"]),
           "total_cost": F(r["total_cost"]), "margin": F(D(r["total_amount"]) - D(r["total_cost"])), "terms": r["terms"], "scope_of_work": r.get("scope_of_work") or "", "tax_pct": float(r.get("tax_pct") if r.get("tax_pct") is not None else 18), "valid_until": r["valid_until"], "sent_at": r["sent_at"],
           "sent_to": r["sent_to"], "override_reason": r["override_reason"], "client_response": r["client_response"], "client_response_at": r["client_response_at"],
           "client_message": r["client_message"], "owner_id": r["owner_id"], "owner_name": r.get("owner_name"), "created_at": r["created_at"], "updated_at": r["updated_at"]}
    if items is not None:
        out["items"] = items
        out["below_cost_lines"] = [i["line_no"] for i in items if i.get("below_cost")]
    return out

_PROPOSAL_SELECT = "SELECT p.*, c.name AS client_name, u.name AS owner_name FROM proposals p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.owner_id"

async def _proposal_or_404(ctx: Ctx, proposal_id: int) -> dict:
    core.require_sales_read(ctx)
    r = await execute_query(_PROPOSAL_SELECT + " WHERE p.id = %s", (proposal_id,), fetch_one=True)
    if not r or (ctx.sales == "sales" and r["owner_id"] != ctx.uid):
        raise HTTPException(status_code=404, detail="Proposal not found")
    return r

def _require_proposal_edit(ctx: Ctx, p: dict) -> None:
    core.require_sales_edit(ctx)
    if not ctx.owns(p["owner_id"]):
        raise HTTPException(status_code=403, detail="You can only work on proposals you own")

def _clean_items(items: list) -> list:
    cleaned = []
    for i, it in enumerate(items, 1):
        if not (it.description or "").strip():
            raise HTTPException(status_code=400, detail=f"Line {i}: description is required")
        if it.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Line {i}: quantity must be greater than zero")
        if it.rate < 0 or it.cost < 0:
            raise HTTPException(status_code=400, detail=f"Line {i}: rate and cost can't be negative")
        cleaned.append({"line_no": i, "description": it.description.strip()[:500], "quantity": it.quantity, "unit": (it.unit or "")[:30], "rate": D(it.rate), "cost": D(it.cost)})
    return cleaned

async def _write_items(proposal_id: int, items: list) -> None:
    await execute_query("DELETE FROM proposal_items WHERE proposal_id = %s", (proposal_id,))
    total, cost = D(0), D(0)
    for it in items:
        await execute_query("INSERT INTO proposal_items (proposal_id, line_no, description, quantity, unit, rate, cost) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                            (proposal_id, it["line_no"], it["description"], it["quantity"], it["unit"], it["rate"], it["cost"]))
        total += D(it["quantity"]) * it["rate"]
        cost += D(it["quantity"]) * it["cost"]
    await execute_query("UPDATE proposals SET total_amount = %s, total_cost = %s, updated_at = %s WHERE id = %s", (total, cost, core.now_iso(), proposal_id))

async def _items(proposal_id: int, with_cost: bool = True) -> list:
    rows = await execute_query("SELECT * FROM proposal_items WHERE proposal_id = %s ORDER BY line_no", (proposal_id,), fetch_all=True)
    return _items_out(rows or [], with_cost)

async def to_proposal(ctx: Ctx, lead_id: int, data) -> dict:
    lead = await _lead_or_404(ctx, lead_id)
    _require_lead_edit(ctx, lead)
    if lead["stage"] not in ("QUALIFIED", "TENDER", "PROPOSAL"):
        raise HTTPException(status_code=400, detail=f"Only a qualified lead can get a proposal (this one is {lead['stage']})")
    if not lead["client_id"]:
        raise HTTPException(status_code=400, detail="A client must exist before a proposal — qualify the lead first")
    if not (data.title or "").strip():
        raise HTTPException(status_code=400, detail="Proposal title is required")
    tender_id = data.tender_id
    if tender_id is not None:
        if not await execute_query("SELECT id FROM tenders WHERE id = %s AND lead_id = %s", (tender_id, lead_id), fetch_one=True):
            raise HTTPException(status_code=400, detail="That tender doesn't belong to this lead")
    else:
        t = await execute_query("SELECT id FROM tenders WHERE lead_id = %s AND status IN ('OPEN', 'SUBMITTED') ORDER BY id DESC LIMIT 1", (lead_id,), fetch_one=True)
        tender_id = t["id"] if t else None
    items = _clean_items(data.items)
    now = core.now_iso()
    pid = await execute_query(
        """INSERT INTO proposals (code, lead_id, tender_id, client_id, title, status, review_status, terms, scope_of_work, tax_pct, valid_until, owner_id, created_by, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, 'DRAFT', 'PENDING', %s, %s, %s, %s, %s, %s, %s, %s)""",
        (core.temp_code(), lead_id, tender_id, lead["client_id"], data.title.strip()[:255], data.terms, data.scope_of_work or "", core.check_pct(data.tax_pct, "GST %"), core.clean_date(data.valid_until, "Valid until"), lead["owner_id"], ctx.uid, now, now), last_id=True)
    await execute_query("UPDATE proposals SET code = %s WHERE id = %s", (core.format_code("PRP", pid), pid))
    await _write_items(pid, items)
    if lead["stage"] != "PROPOSAL":
        await _set_stage(ctx, lead, "PROPOSAL", f"Proposal {core.format_code('PRP', pid)} drafted")
    else:
        await core.log_activity(lead_id, "NOTE", f"Proposal {core.format_code('PRP', pid)} drafted", ctx)
    return await get_proposal(ctx, pid)

async def get_proposal(ctx: Ctx, proposal_id: int) -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    out = proposal_out(p, await _items(proposal_id), ctx)
    out["files"] = [dict(f) for f in (await execute_query("SELECT id, filename, content_type, size_bytes, uploaded_at FROM proposal_files WHERE proposal_id = %s ORDER BY id", (proposal_id,), fetch_all=True) or [])]
    return out

async def list_proposals(ctx: Ctx, *, lead_id: int = 0, client_id: int = 0, status: str = "", review_status: str = "") -> list:
    core.require_sales_read(ctx)
    where, args = [], []
    if ctx.sales == "sales":
        where.append("p.owner_id = %s"); args.append(ctx.uid)
    for col, val, allowed, label in (("p.lead_id", lead_id, None, ""), ("p.client_id", client_id, None, ""), ("p.status", status, core.PROPOSAL_STATUSES, "status"), ("p.review_status", review_status, core.REVIEW_STATUSES, "review status")):
        if val:
            if allowed:
                core.check(val, allowed, label)
            where.append(f"{col} = %s"); args.append(val)
    rows = await execute_query(_PROPOSAL_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY p.id DESC LIMIT 500", tuple(args), fetch_all=True)
    return [proposal_out(r) for r in (rows or [])]

async def update_proposal(ctx: Ctx, proposal_id: int, data) -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    reopen = p["status"] == "SENT" and p["review_status"] == "CHANGES_ASKED"
    if p["status"] != "DRAFT" and not reopen:
        raise HTTPException(status_code=400, detail="A sent proposal can only be edited after the client or a manager asked for changes")
    changes = {k: v for k, v in data.model_dump(exclude={"items"}).items() if k in data.model_fields_set}
    if "title" in changes and not (changes["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Proposal title can't be empty")
    if "valid_until" in changes:
        changes["valid_until"] = core.clean_date(changes["valid_until"], "Valid until")
    if "tax_pct" in changes:
        changes["tax_pct"] = core.check_pct(changes["tax_pct"], "GST %")
    if reopen:      # edited after a change request: back to DRAFT, to be reviewed and sent again (the old link stops working)
        changes.update({"status": "DRAFT", "review_status": "PENDING", "public_token": None, "client_response": None, "client_response_at": None, "client_message": None})
    if not changes and data.items is None:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if changes:
        changes["updated_at"] = core.now_iso()
        await execute_query(f"UPDATE proposals SET {', '.join(f'{k} = %s' for k in changes)} WHERE id = %s", (*changes.values(), proposal_id))
    if data.items is not None:
        await _write_items(proposal_id, _clean_items(data.items))
    if reopen:
        await core.log_activity(p["lead_id"], "NOTE", f"Proposal {p['code']} revised after change request", ctx)
    return await get_proposal(ctx, proposal_id)

async def upload_file(ctx: Ctx, proposal_id: int, filename: str, data: bytes, max_bytes: int) -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    if p["status"] in ("ACCEPTED", "REJECTED"):
        raise HTTPException(status_code=400, detail="This proposal is closed")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in FILE_TYPES:
        raise HTTPException(status_code=400, detail=f"Allowed file types: {', '.join(FILE_TYPES)}")
    if not data or len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"The file must be between 1 byte and {max_bytes // (1024 * 1024)} MB")
    fid = await execute_query("INSERT INTO proposal_files (proposal_id, filename, content_type, size_bytes, data, uploaded_by, uploaded_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                              (proposal_id, re.sub(r"[^\w.\- ]", "_", filename)[:200], FILE_TYPES[ext], len(data), data, ctx.uid, core.now_iso()), last_id=True)
    return {"id": fid, "filename": filename, "size_bytes": len(data)}

async def get_file(ctx: Ctx, proposal_id: int, file_id: int) -> dict:
    await _proposal_or_404(ctx, proposal_id)
    f = await execute_query("SELECT filename, content_type, data FROM proposal_files WHERE id = %s AND proposal_id = %s", (file_id, proposal_id), fetch_one=True)
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    return {"filename": f["filename"], "content_type": f["content_type"], "data": bytes(f["data"])}

async def delete_file(ctx: Ctx, proposal_id: int, file_id: int) -> None:
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    if await execute_query("DELETE FROM proposal_files WHERE id = %s AND proposal_id = %s", (file_id, proposal_id)) == 0:
        raise HTTPException(status_code=404, detail="File not found")

def public_base(request_base: str = "") -> str:
    return (PUBLIC_API_URL or request_base or FRONTEND_URL).rstrip("/")

async def proposal_pdf(ctx: Ctx, proposal_id: int):
    p = await _proposal_or_404(ctx, proposal_id)
    return await _build_pdf(p)

async def _build_pdf(p: dict):
    client = await core.client_or_404(p["client_id"])
    items = await _items(p["id"], with_cost=False)
    return generate_proposal_pdf({"code": p["code"], "title": p["title"], "terms": p["terms"], "scope_of_work": p.get("scope_of_work") or "", "valid_until": p["valid_until"],
                                  "total_amount": p["total_amount"], "tax_pct": p.get("tax_pct"), "created_at": p["created_at"]}, items, dict(client))

async def send_proposal(ctx: Ctx, proposal_id: int, data, base_url: str = "") -> dict:
    """DRAFT → SENT: emails the PDF with a public reply link. Lines priced below cost need an override reason, which only a manager may give."""
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    if p["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail=f"Only a DRAFT proposal can be sent (this one is {p['status']}); use 'email' to send it again")
    items = await _items(proposal_id)
    if not items:
        raise HTTPException(status_code=400, detail="Add at least one item before sending")
    if D(p["total_amount"]) <= 0:
        raise HTTPException(status_code=400, detail="The proposal total must be greater than zero")
    below = [i["line_no"] for i in items if i["below_cost"]]
    reason = (data.override_reason or "").strip()
    if below or D(p["total_amount"]) < D(p["total_cost"]):
        if not reason:
            raise HTTPException(status_code=400, detail={"message": f"Lines {', '.join(map(str, below)) or '(total)'} are priced below cost. Sending needs an explicit override with a reason.", "below_cost_lines": below, "needs_override": True})
        if ctx.sales != "mgr":
            raise HTTPException(status_code=403, detail="Only a sales manager can approve sending a below-cost proposal")
    lead = await execute_query("SELECT * FROM leads WHERE id = %s", (p["lead_id"],), fetch_one=True)
    to = (data.to or (lead["email"] if lead else None) or "").strip()
    if not core.valid_email(to):
        raise HTTPException(status_code=400, detail="Enter the email address to send the proposal to")
    token = core.new_token()
    now = core.now_iso()
    await execute_query("UPDATE proposals SET status = 'SENT', review_status = 'PENDING', sent_at = %s, sent_to = %s, override_reason = %s, public_token = %s, client_response = NULL, updated_at = %s WHERE id = %s",
                        (now, to, reason or None, token, now, proposal_id))
    await core.log_activity(p["lead_id"], "EMAIL", f"Proposal {p['code']} sent to {to}" + (f" (below-cost override: {reason})" if reason else ""), ctx)
    await _email_proposal(await _proposal_or_404(ctx, proposal_id), to, data.subject, data.message, base_url, ctx.name)
    return await get_proposal(ctx, proposal_id)

async def _email_proposal(p: dict, to: str, subject: Optional[str], message: str, base_url: str, sender_name: str) -> None:
    client = await core.client_or_404(p["client_id"])
    link = f"{public_base(base_url)}/api/public/proposals/{p['public_token']}/page"
    pdf = await _build_pdf(p)
    html_body = _proposal_email_html(client["name"], p["title"], p["code"], float(p["total_amount"]), message or "", link, sender_name)
    asyncio.get_running_loop().run_in_executor(None, _send_email_with_pdf, to, subject or f"Proposal {p['code']}: {p['title']}", html_body, pdf, f"{p['code']}.pdf", "sales")

async def email_proposal_again(ctx: Ctx, proposal_id: int, data, base_url: str = "") -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    if p["status"] != "SENT":
        raise HTTPException(status_code=400, detail="Only a sent proposal can be emailed again")
    to = (data.to or p["sent_to"] or "").strip()
    if not core.valid_email(to):
        raise HTTPException(status_code=400, detail="Enter the email address to send the proposal to")
    await _email_proposal(p, to, data.subject, data.message, base_url, ctx.name)
    await core.log_activity(p["lead_id"], "EMAIL", f"Proposal {p['code']} emailed again to {to}", ctx)
    return {"message": f"Emailed to {to}"}

async def review_proposal(ctx: Ctx, proposal_id: int, data) -> dict:
    """Design / scope review by a manager: APPROVED unlocks booking the PO; CHANGES_ASKED sends it back for revision."""
    core.require_manager(ctx)
    p = await _proposal_or_404(ctx, proposal_id)
    core.check(data.status, ("APPROVED", "CHANGES_ASKED"), "review status")
    if p["status"] != "SENT":
        raise HTTPException(status_code=400, detail=f"Only a sent proposal can be reviewed (this one is {p['status']})")
    if data.status == "CHANGES_ASKED" and not (data.note or "").strip():
        raise HTTPException(status_code=400, detail="Say what needs to change")
    await execute_query("UPDATE proposals SET review_status = %s, review_note = %s, reviewed_by = %s, reviewed_at = %s, updated_at = %s WHERE id = %s",
                        (data.status, data.note.strip() or None, ctx.uid, core.now_iso(), core.now_iso(), proposal_id))
    await core.log_activity(p["lead_id"], "NOTE", f"Proposal {p['code']} review: {data.status}" + (f" — {data.note.strip()}" if data.note.strip() else ""), ctx)
    return await get_proposal(ctx, proposal_id)

async def reject_proposal(ctx: Ctx, proposal_id: int, reason: str) -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    if p["status"] not in ("DRAFT", "SENT"):
        raise HTTPException(status_code=400, detail=f"A {p['status']} proposal can't be rejected")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason")
    await execute_query("UPDATE proposals SET status = 'REJECTED', public_token = NULL, updated_at = %s WHERE id = %s", (core.now_iso(), proposal_id))
    await core.log_activity(p["lead_id"], "NOTE", f"Proposal {p['code']} rejected — {reason.strip()}", ctx)
    return await get_proposal(ctx, proposal_id)


# ---------- public reply (no login; the unguessable token is the credential) ----------

async def _public_proposal(token: str) -> dict:
    p = None
    if token and len(token) >= 20:
        p = await execute_query(_PROPOSAL_SELECT + " WHERE p.public_token = %s AND p.status IN ('SENT', 'ACCEPTED')", (token,), fetch_one=True)
    if not p:
        raise HTTPException(status_code=404, detail="This link is not valid")
    return p

async def public_view(token: str) -> dict:
    """Only what the client should see for that one proposal: no costs, margins, owners or internal notes."""
    p = await _public_proposal(token)
    items = await _items(p["id"], with_cost=False)
    return {"code": p["code"], "title": p["title"], "client_name": p["client_name"], "total_amount": F(p["total_amount"]), "terms": p["terms"], "scope_of_work": p.get("scope_of_work") or "", "valid_until": p["valid_until"],
            "sent_at": p["sent_at"], "items": [{k: i[k] for k in ("line_no", "description", "quantity", "unit", "rate", "amount")} for i in items],
            "status": p["status"], "your_reply": p["client_response"], "can_reply": p["status"] == "SENT"}

async def public_reply(token: str, data) -> dict:
    p = await _public_proposal(token)
    if p["status"] != "SENT":
        raise HTTPException(status_code=409, detail="This proposal has already been processed")
    action = (data.action or "").lower()
    if action not in ("accept", "changes"):
        raise HTTPException(status_code=400, detail="Reply with 'accept' or 'changes'")
    message = (data.message or "").strip()[:2000]
    if action == "changes" and not message:
        raise HTTPException(status_code=400, detail="Tell us what you'd like changed")
    response = "ACCEPTED" if action == "accept" else "CHANGES_ASKED"
    sets, args = ["client_response = %s", "client_response_at = %s", "client_message = %s", "updated_at = %s"], [response, core.now_iso(), message or None, core.now_iso()]
    if action == "changes":
        sets += ["review_status = 'CHANGES_ASKED'", "review_note = %s"]; args.append(f"Client asked for changes: {message}")
    await execute_query(f"UPDATE proposals SET {', '.join(sets)} WHERE id = %s", (*args, p["id"]))
    who = (data.name or "").strip()[:100] or p["client_name"]
    await core.log_activity(p["lead_id"], "EMAIL", f"Client reply to {p['code']} via link ({who}): {'ACCEPTED' if action == 'accept' else 'asked for changes'}" + (f" — {message}" if message else ""), by_name=f"{who} (client)")
    owner = await execute_query("SELECT email FROM users WHERE id = %s", (p["owner_id"],), fetch_one=True)
    if owner and owner["email"]:
        asyncio.get_running_loop().run_in_executor(None, _send_email, [owner["email"]], f"{p['code']}: client {'accepted' if action == 'accept' else 'asked for changes'}",
                                                   _proposal_reply_email_html(p["code"], p["title"], p["client_name"], action, message), "sales")
    return {"message": "Thank you — your reply has been recorded." if action == "accept" else "Thank you — we'll get back to you with the changes.", "reply": response}


# ====================================================================== contracts & engagements

def contract_out(r: dict) -> dict:
    value, cost = D(r["contract_value"]), D(r["estimated_cost"])
    margin = value - cost
    return {"id": r["id"], "code": r["code"], "client_id": r["client_id"], "client_name": r.get("client_name"), "client_email": r.get("client_email"), "proposal_id": r["proposal_id"], "lead_id": r["lead_id"], "contract_no": r["contract_no"],
            "po_date": r["po_date"], "po_reference": r["po_reference"], "contract_value": F(value), "start_date": r["start_date"], "end_date": r["end_date"], "status": r["status"],
            "estimated_cost": F(cost), "margin": F(margin), "margin_pct": round(float(margin / value * 100), 2) if value > 0 else None,
            "engagement_project_id": r["engagement_project_id"], "engagement_name": r.get("engagement_name"), "created_at": r["created_at"],
            "scope_of_work": r.get("scope_of_work") or "", "agreement_terms": r.get("agreement_terms") or "", "agreement_status": r.get("agreement_status") or "NONE",
            "agreement_signed_on": r.get("agreement_signed_on"), "po_files": int(r.get("po_files") or 0), "signed_files": int(r.get("signed_files") or 0),
            "readiness": {"po_document": int(r.get("po_files") or 0) > 0, "agreement_signed": (r.get("agreement_status") or "NONE") == "SIGNED", "scope_defined": bool((r.get("scope_of_work") or "").strip())}}

_CONTRACT_SELECT = ("SELECT k.*, c.name AS client_name, c.email AS client_email, pr.name AS engagement_name, "
                    "(SELECT COUNT(*) FROM contract_files f WHERE f.contract_id = k.id AND f.kind = 'PO') AS po_files, "
                    "(SELECT COUNT(*) FROM contract_files f WHERE f.contract_id = k.id AND f.kind = 'SIGNED_AGREEMENT') AS signed_files FROM contracts k JOIN clients c ON c.id = k.client_id LEFT JOIN projects pr ON pr.id = k.engagement_project_id")

async def _contract_or_404(ctx: Ctx, contract_id: int, *, accounts_ok: bool = True) -> dict:
    if not (ctx.sales or (accounts_ok and ctx.acct)):
        raise HTTPException(status_code=403, detail="You don't have access to contracts")
    r = await execute_query(_CONTRACT_SELECT + " WHERE k.id = %s", (contract_id,), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Contract not found")
    if ctx.sales == "sales" and not ctx.acct:
        p = await execute_query("SELECT owner_id FROM proposals WHERE id = %s", (r["proposal_id"],), fetch_one=True)
        if not p or p["owner_id"] != ctx.uid:
            raise HTTPException(status_code=404, detail="Contract not found")
    return r

async def get_contract(ctx: Ctx, contract_id: int) -> dict:
    return contract_out(await _contract_or_404(ctx, contract_id))

async def list_contracts(ctx: Ctx, *, client_id: int = 0, status: str = "") -> list:
    core.require_any(ctx)
    where, args = [], []
    if ctx.sales == "sales" and not ctx.acct:
        where.append("k.proposal_id IN (SELECT id FROM proposals WHERE owner_id = %s)"); args.append(ctx.uid)
    if client_id:
        where.append("k.client_id = %s"); args.append(client_id)
    if status:
        where.append("k.status = %s"); args.append(core.check(status, core.CONTRACT_STATUSES, "status"))
    rows = await execute_query(_CONTRACT_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY k.id DESC LIMIT 500", tuple(args), fetch_all=True)
    return [contract_out(r) for r in (rows or [])]

async def book_po(ctx: Ctx, proposal_id: int, data) -> dict:
    """PO won: only for a SENT proposal whose review is APPROVED. Sets proposal ACCEPTED, tender WON, lead WON and creates the contract (DRAFT)."""
    core.require_manager(ctx)
    p = await _proposal_or_404(ctx, proposal_id)
    problems = []
    if p["status"] != "SENT":
        problems.append(f"the proposal must be SENT (it is {p['status']})")
    if p["review_status"] != "APPROVED":
        problems.append(f"its review must be APPROVED (it is {p['review_status']})")
    if problems:
        raise HTTPException(status_code=400, detail={"message": "The PO can't be booked: " + " and ".join(problems), "problems": problems})
    if not (data.po_reference or "").strip():
        raise HTTPException(status_code=400, detail="Enter the PO reference")
    start, end = core.clean_date(data.start_date, "Start date"), core.clean_date(data.end_date, "End date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date can't be before the start date")
    value = D(data.contract_value) if data.contract_value is not None else D(p["total_amount"])
    if value <= 0:
        raise HTTPException(status_code=400, detail="Contract value must be greater than zero")
    client = await core.client_or_404(p["client_id"])              # a client must exist before the contract
    now = core.now_iso()
    try:
        kid = await execute_query(
            """INSERT INTO contracts (code, client_id, proposal_id, lead_id, contract_no, po_date, po_reference, contract_value, start_date, end_date, status, estimated_cost, booked_by, created_at, updated_at, scope_of_work)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'DRAFT', %s, %s, %s, %s, %s)""",
            (core.temp_code(), client["id"], proposal_id, p["lead_id"], (data.contract_no or "").strip() or None, core.clean_date(data.po_date, "PO date") or core.today().isoformat(),
             data.po_reference.strip()[:120], value, start, end, p["total_cost"], ctx.uid, now, now, p.get("scope_of_work") or ""), last_id=True)
    except pymysql.err.IntegrityError:
        raise HTTPException(status_code=409, detail="A PO has already been booked for this proposal")
    await execute_query("UPDATE contracts SET code = %s WHERE id = %s", (core.format_code("CTR", kid), kid))
    await execute_query("UPDATE proposals SET status = 'ACCEPTED', updated_at = %s WHERE id = %s", (now, proposal_id))
    if p["tender_id"]:
        await execute_query("UPDATE tenders SET status = 'WON' WHERE id = %s", (p["tender_id"],))
    lead = await execute_query(_LEAD_SELECT + " WHERE l.id = %s", (p["lead_id"],), fetch_one=True)
    await _set_stage(ctx, lead, "WON", f"PO {data.po_reference.strip()} booked on {p['code']} → contract {core.format_code('CTR', kid)}", {"won_at": now})
    return contract_out(await execute_query(_CONTRACT_SELECT + " WHERE k.id = %s", (kid,), fetch_one=True))

async def update_contract(ctx: Ctx, contract_id: int, data) -> dict:
    core.require_manager(ctx)
    k = await _contract_or_404(ctx, contract_id)
    if k["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail="Only a DRAFT contract can be edited")
    changes = {kk: v for kk, v in data.model_dump().items() if kk in data.model_fields_set}
    for key, label in (("po_date", "PO date"), ("start_date", "Start date"), ("end_date", "End date")):
        if key in changes:
            changes[key] = core.clean_date(changes[key], label)
    for key in ("contract_value", "estimated_cost"):
        if key in changes:
            if changes[key] is None or changes[key] < 0:
                raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} must be zero or more")
            changes[key] = D(changes[key])
    s, e = changes.get("start_date", k["start_date"]), changes.get("end_date", k["end_date"])
    if s and e and e < s:
        raise HTTPException(status_code=400, detail="End date can't be before the start date")
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    changes["updated_at"] = core.now_iso()
    await execute_query(f"UPDATE contracts SET {', '.join(f'{kk} = %s' for kk in changes)} WHERE id = %s", (*changes.values(), contract_id))
    return await get_contract(ctx, contract_id)

async def _unique_project_key(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name)
    base = ("".join(w[0] for w in words)[:4] or "ENG").upper()
    if not base[0].isalpha() or len(base) < 2:
        base = ("E" + base)[:4].ljust(2, "X")
    key, n = base, 1
    while await execute_query("SELECT id FROM projects WHERE project_key = %s", (key,), fetch_one=True):
        n += 1
        key = f"{base}{n}"
    return key

async def create_engagement(ctx: Ctx, contract_id: int, data) -> dict:
    """Create the engagement (an ordinary project on the project board) from a contract in one go, or link an existing project. The contract becomes ACTIVE."""
    core.require_manager(ctx)
    k = await _contract_or_404(ctx, contract_id)
    if k["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail=f"Only a DRAFT contract can get an engagement (this one is {k['status']})")
    if k["engagement_project_id"]:
        raise HTTPException(status_code=409, detail="This contract already has an engagement")
    client = await core.client_or_404(k["client_id"])
    now = core.now_iso()
    if data.project_id is not None:
        proj = await execute_query("SELECT id, name, contract_id FROM projects WHERE id = %s", (data.project_id,), fetch_one=True)
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
        if proj["contract_id"] and proj["contract_id"] != contract_id:
            raise HTTPException(status_code=409, detail="That project is already the engagement of another contract")
        project_id, linked = proj["id"], True
        await execute_query("UPDATE projects SET client_id = %s, contract_id = %s, updated_at = %s WHERE id = %s", (client["id"], contract_id, now, project_id))
    else:
        name = (data.name or f"{client['name']} — {k['contract_no'] or k['code']}").strip()[:200]
        project_id = await execute_query(
            "INSERT INTO projects (name, project_key, description, status, owner_id, client_id, contract_id, created_at, updated_at) VALUES (%s, %s, %s, 'active', %s, %s, %s, %s, %s)",
            (name, await _unique_project_key(name), f"Engagement for contract {k['code']} ({client['name']})", ctx.uid, client["id"], contract_id, now, now), last_id=True)
        linked = False
    await execute_query("UPDATE contracts SET engagement_project_id = %s, status = 'ACTIVE', updated_at = %s WHERE id = %s", (project_id, now, contract_id))
    if k["lead_id"]:
        await core.log_activity(k["lead_id"], "STAGE_CHANGE", f"Contract {k['code']} ACTIVE — engagement {'linked' if linked else 'created'} (project #{project_id})", ctx)
    return await get_contract(ctx, contract_id)

async def set_contract_status(ctx: Ctx, contract_id: int, data) -> dict:
    core.require_manager(ctx)
    k = await _contract_or_404(ctx, contract_id)
    core.check(data.status, ("COMPLETED", "TERMINATED"), "status")
    if k["status"] != "ACTIVE":
        raise HTTPException(status_code=400, detail=f"Only an ACTIVE contract can be {data.status.lower()} (this one is {k['status']})")
    if data.status == "TERMINATED" and not (data.note or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for terminating the contract")
    await execute_query("UPDATE contracts SET status = %s, updated_at = %s WHERE id = %s", (data.status, core.now_iso(), contract_id))
    if k["lead_id"]:
        await core.log_activity(k["lead_id"], "STAGE_CHANGE", f"Contract {k['code']} {data.status}" + (f" — {data.note.strip()}" if data.note.strip() else ""), ctx)
    return await get_contract(ctx, contract_id)


# ====================================================================== pipeline summary

async def pipeline_summary(ctx: Ctx) -> dict:
    """Counts and values per lead stage plus proposals / contracts / follow-ups, for the Sales Flow step bar."""
    core.require_sales_read(ctx)
    scope, args = lead_scope(ctx)
    rows = await execute_query(f"SELECT l.stage, COUNT(*) AS n, COALESCE(SUM(l.estimated_value), 0) AS value FROM leads l WHERE {scope} GROUP BY l.stage", tuple(args), fetch_all=True)
    by_stage = {s: {"count": 0, "value": 0.0} for s in core.LEAD_STAGES}
    for r in (rows or []):
        by_stage[r["stage"]] = {"count": int(r["n"]), "value": F(r["value"])}
    pscope, pargs = ("", []) if ctx.sees_all_sales else (" WHERE p.owner_id = %s", [ctx.uid])
    prop = await execute_query(f"SELECT p.status, p.review_status, COUNT(*) AS n FROM proposals p{pscope} GROUP BY p.status, p.review_status", tuple(pargs), fetch_all=True)
    proposals = {"DRAFT": 0, "SENT": 0, "ACCEPTED": 0, "REJECTED": 0, "awaiting_review": 0, "changes_asked": 0, "approved_not_booked": 0}
    for r in (prop or []):
        proposals[r["status"]] += int(r["n"])
        if r["status"] == "SENT":
            key = {"PENDING": "awaiting_review", "CHANGES_ASKED": "changes_asked", "APPROVED": "approved_not_booked"}[r["review_status"]]
            proposals[key] += int(r["n"])
    cscope, cargs = ("", []) if ctx.sees_all_sales else (" WHERE k.proposal_id IN (SELECT id FROM proposals WHERE owner_id = %s)", [ctx.uid])
    con = await execute_query(f"SELECT k.status, COUNT(*) AS n FROM contracts k{cscope} GROUP BY k.status", tuple(cargs), fetch_all=True)
    contracts = {s: 0 for s in core.CONTRACT_STATUSES}
    for r in (con or []):
        contracts[r["status"]] = int(r["n"])
    od = await execute_query(f"SELECT COUNT(*) AS n FROM leads l WHERE {scope} AND l.next_followup_at IS NOT NULL AND l.next_followup_at <= %s AND l.stage IN ('NEW', 'CONTACTED', 'QUALIFIED', 'TENDER', 'PROPOSAL')",
                             (*args, core.today().isoformat()), fetch_one=True)
    steps = [("Lead Capture", by_stage["NEW"]["count"] + by_stage["CONTACTED"]["count"]), ("Qualify", by_stage["QUALIFIED"]["count"] + by_stage["TENDER"]["count"]),
             ("Proposal Sent", proposals["DRAFT"] + proposals["SENT"]), ("Review", proposals["awaiting_review"] + proposals["changes_asked"]),
             ("PO Won", proposals["approved_not_booked"] + contracts["DRAFT"]), ("Convert to Engagement", contracts["DRAFT"]), ("Closed", by_stage["WON"]["count"] + by_stage["LOST"]["count"])]
    return {"leads_by_stage": by_stage, "proposals": proposals, "contracts": contracts, "overdue_followups": int(od["n"]), "steps": [{"step": s, "count": n} for s, n in steps]}
