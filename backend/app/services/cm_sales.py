"""Client Management — accounts (clients), proposals (items, files, send, review, PDF, public reply), contracts and engagements.

The CRM side (leads, opportunities, follow-ups, activity log) lives in ``cm_crm``. A Closed Won opportunity leads here: proposal → sent → review → PO → contract → engagement.
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


async def _note(row: dict, body: str, ctx: Optional[Ctx] = None, kind: str = "Note", by_name: str = "System") -> None:
    """A system note in the activity log against the company (and opportunity) a proposal / contract belongs to."""
    client = await execute_query("SELECT id, name FROM clients WHERE id = %s", (row.get("client_id"),), fetch_one=True)
    owner = None
    if row.get("opportunity_id"):                                   # the note belongs to the opportunity's owner, so that person sees it in their activity
        o = await execute_query("SELECT owner_id FROM opportunities WHERE id = %s", (row["opportunity_id"],), fetch_one=True)
        owner = o["owner_id"] if o else None
    await core.log_activity(client["name"] if client else "—", body, activity_type=kind, outcome=None, ctx=ctx, by_name=by_name, owner_id=owner, client_id=row.get("client_id"), opportunity_id=row.get("opportunity_id"), lead_id=row.get("lead_id"))


# ====================================================================== clients

def client_out(r: dict) -> dict:
    return {"id": r["id"], "code": r["code"], "name": r["name"], "gstin": r["gstin"], "billing_address": r["billing_address"] or r["address"], "contact_person": r["contact_person"],
            "phone": r["phone"], "email": r["email"], "default_tds_pct": float(r["default_tds_pct"] or 0), "default_retention_pct": float(r["default_retention_pct"] or 0),
            "is_active": r["status"] == "active", "created_at": r["created_at"],
            "industry": r.get("industry"), "location": r.get("location"), "website": r.get("website"), "account_type": r.get("account_type") or "Prospect", "notes": r.get("notes") or "",
            "owner_id": r.get("owner_id"), "owner_name": r.get("owner_name") or r.get("owner_label")}

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

async def _account_fields(data, ctx: Ctx) -> dict:
    """The sheet's account columns, validated: industry and account type come from the dropdown lists; the owner is a user (default: the person creating it)."""
    out = {}
    fields = data.model_fields_set if hasattr(data, "model_fields_set") else set()
    for key in ("industry", "location", "website", "notes"):
        if key in fields:
            out[key] = (getattr(data, key) or "").strip() or None
    if out.get("industry"):
        core.check(out["industry"], core.INDUSTRIES, "industry")
    if "account_type" in fields and data.account_type is not None:
        out["account_type"] = core.check(data.account_type, core.ACCOUNT_TYPES, "account type")
    if "owner_id" in fields and data.owner_id is not None:
        await core.user_or_400(data.owner_id, "Owner")
        out["owner_id"] = data.owner_id
    elif ctx is not None and "owner_id" not in fields and hasattr(data, "name"):
        out["owner_id"] = ctx.uid
    return out

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
    extra = await _account_fields(data, ctx)
    cid = await execute_query(
        """INSERT INTO clients (code, name, gstin, billing_address, address, contact_person, phone, email, default_tds_pct, default_retention_pct, status, created_at,
                                industry, location, website, account_type, owner_id, owner_label, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (core.temp_code(), name[:200], gstin, data.billing_address, data.billing_address, data.contact_person, (data.phone or "").strip(), (data.email or "").strip(), tds, ret,
         "active" if data.is_active else "inactive", core.now_iso(), extra.get("industry"), extra.get("location"), extra.get("website"), extra.get("account_type", "Prospect"),
         extra.get("owner_id"), extra.get("owner_label"), extra.get("notes")), last_id=True)
    await execute_query("UPDATE clients SET code = %s WHERE id = %s", (core.format_code("A", cid), cid))
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
    changes.update(await _account_fields(data, None))
    for k in ("industry", "location", "website", "notes", "account_type", "owner_id"):
        if k in (data.model_fields_set or set()) and k not in changes:
            changes[k] = None if k not in ("account_type",) else cur.get("account_type")
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

_CLIENT_SELECT = "SELECT c.*, u.name AS owner_name FROM clients c LEFT JOIN users u ON u.id = c.owner_id"

async def list_clients(ctx: Ctx, q: str = "", active: Optional[bool] = None, account_type: str = "", industry: str = "", owner_id: int = 0) -> list:
    core.require_any(ctx)
    where, args = [], []
    if q.strip():
        like = f"%{q.strip()}%"; where.append("(c.name LIKE %s OR c.code LIKE %s OR c.gstin LIKE %s OR c.contact_person LIKE %s OR c.phone LIKE %s OR c.email LIKE %s OR c.location LIKE %s)"); args += [like] * 7
    if active is not None:
        where.append("c.status = %s"); args.append("active" if active else "inactive")
    for col, val, allowed, label in (("c.account_type", account_type, core.ACCOUNT_TYPES, "account type"), ("c.industry", industry, core.INDUSTRIES, "industry")):
        if val:
            core.check(val, allowed, label); where.append(f"{col} = %s"); args.append(val)
    if owner_id:
        where.append("c.owner_id = %s"); args.append(owner_id)
    rows = await execute_query(_CLIENT_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY c.name LIMIT 5000", tuple(args), fetch_all=True)
    return [client_out(r) for r in (rows or [])]

async def get_client(ctx: Ctx, client_id: int) -> dict:
    core.require_any(ctx)
    return client_out(await execute_query(_CLIENT_SELECT + " WHERE c.id = %s", (client_id,), fetch_one=True) or await core.client_or_404(client_id))

async def delete_client(ctx: Ctx, client_id: int) -> None:
    core.require_manager(ctx)
    await core.client_or_404(client_id)
    for table in ("leads", "opportunities", "followups", "activity_log", "contracts", "proposals", "invoices", "client_payments", "client_advances"):
        if await execute_query(f"SELECT id FROM {table} WHERE client_id = %s LIMIT 1", (client_id,), fetch_one=True):
            raise HTTPException(status_code=409, detail="This client has history — mark it inactive instead of deleting it")
    await execute_query("DELETE FROM clients WHERE id = %s", (client_id,))


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
    out = {"id": r["id"], "code": r["code"], "opportunity_id": r.get("opportunity_id"), "opportunity_name": r.get("opportunity_name"), "client_id": r["client_id"], "client_name": r.get("client_name"), "title": r["title"],
           "status": r["status"], "review_status": r["review_status"], "review_note": r["review_note"], "reviewed_at": r["reviewed_at"], "total_amount": F(r["total_amount"]),
           "total_cost": F(r["total_cost"]), "margin": F(D(r["total_amount"]) - D(r["total_cost"])), "terms": r["terms"], "scope_of_work": r.get("scope_of_work") or "", "tax_pct": float(r.get("tax_pct") if r.get("tax_pct") is not None else 18), "valid_until": r["valid_until"], "sent_at": r["sent_at"],
           "sent_to": r["sent_to"], "override_reason": r["override_reason"], "client_response": r["client_response"], "client_response_at": r["client_response_at"],
           "client_message": r["client_message"], "owner_id": r["owner_id"], "owner_name": r.get("owner_name"), "created_at": r["created_at"], "updated_at": r["updated_at"]}
    if items is not None:
        out["items"] = items
        out["below_cost_lines"] = [i["line_no"] for i in items if i.get("below_cost")]
    return out

_PROPOSAL_SELECT = ("SELECT p.*, c.name AS client_name, u.name AS owner_name, o.opp_name AS opportunity_name FROM proposals p JOIN clients c ON c.id = p.client_id "
                    "LEFT JOIN users u ON u.id = p.owner_id LEFT JOIN opportunities o ON o.id = p.opportunity_id")

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

async def to_proposal(ctx: Ctx, opportunity_id: int, data) -> dict:
    """Draft a proposal on an opportunity (its account is the client)."""
    from app.services.cm_crm import opportunity_or_404, require_opportunity_edit
    opp = await opportunity_or_404(ctx, opportunity_id)
    require_opportunity_edit(ctx, opp)
    if opp["stage"] in ("Closed Won", "Closed Lost"):
        raise HTTPException(status_code=400, detail=f"This opportunity is {opp['stage']} — reopen it to draft another proposal")
    if not (data.title or "").strip():
        raise HTTPException(status_code=400, detail="Proposal title is required")
    items = _clean_items(data.items)
    now = core.now_iso()
    pid = await execute_query(
        """INSERT INTO proposals (code, opportunity_id, client_id, title, status, review_status, terms, scope_of_work, tax_pct, valid_until, owner_id, created_by, created_at, updated_at)
           VALUES (%s, %s, %s, %s, 'DRAFT', 'PENDING', %s, %s, %s, %s, %s, %s, %s, %s)""",
        (core.temp_code(), opportunity_id, opp["client_id"], data.title.strip()[:255], data.terms, data.scope_of_work or "", core.check_pct(data.tax_pct, "GST %"), core.clean_date(data.valid_until, "Valid until"),
         opp["owner_id"] or ctx.uid, ctx.uid, now, now), last_id=True)
    await execute_query("UPDATE proposals SET code = %s WHERE id = %s", (core.format_code("PRP", pid), pid))
    await _write_items(pid, items)
    await _note({"client_id": opp["client_id"], "opportunity_id": opportunity_id}, f"Proposal {core.format_code('PRP', pid)} drafted", ctx)
    return await get_proposal(ctx, pid)

async def get_proposal(ctx: Ctx, proposal_id: int) -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    out = proposal_out(p, await _items(proposal_id), ctx)
    out["files"] = [dict(f) for f in (await execute_query("SELECT id, filename, content_type, size_bytes, uploaded_at FROM proposal_files WHERE proposal_id = %s ORDER BY id", (proposal_id,), fetch_all=True) or [])]
    return out

async def list_proposals(ctx: Ctx, *, opportunity_id: int = 0, client_id: int = 0, status: str = "", review_status: str = "") -> list:
    core.require_sales_read(ctx)
    where, args = [], []
    if ctx.sales == "sales":
        where.append("p.owner_id = %s"); args.append(ctx.uid)
    for col, val, allowed, label in (("p.opportunity_id", opportunity_id, None, ""), ("p.client_id", client_id, None, ""), ("p.status", status, core.PROPOSAL_STATUSES, "status"), ("p.review_status", review_status, core.REVIEW_STATUSES, "review status")):
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
        await _note(p, f"Proposal {p['code']} revised after change request", ctx)
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
    account = await execute_query("SELECT email FROM clients WHERE id = %s", (p["client_id"],), fetch_one=True)
    to = (data.to or (account["email"] if account else None) or "").strip()
    if not core.valid_email(to):
        raise HTTPException(status_code=400, detail="Enter the email address to send the proposal to")
    token = core.new_token()
    now = core.now_iso()
    await execute_query("UPDATE proposals SET status = 'SENT', review_status = 'PENDING', sent_at = %s, sent_to = %s, override_reason = %s, public_token = %s, client_response = NULL, updated_at = %s WHERE id = %s",
                        (now, to, reason or None, token, now, proposal_id))
    await _note(p, f"Proposal {p['code']} sent to {to}" + (f" (below-cost override: {reason})" if reason else ""), ctx, "Email")
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
    await _note(p, f"Proposal {p['code']} emailed again to {to}", ctx, "Email")
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
    await _note(p, f"Proposal {p['code']} review: {data.status}" + (f" — {data.note.strip()}" if data.note.strip() else ""), ctx)
    return await get_proposal(ctx, proposal_id)

async def reject_proposal(ctx: Ctx, proposal_id: int, reason: str) -> dict:
    p = await _proposal_or_404(ctx, proposal_id)
    _require_proposal_edit(ctx, p)
    if p["status"] not in ("DRAFT", "SENT"):
        raise HTTPException(status_code=400, detail=f"A {p['status']} proposal can't be rejected")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason")
    await execute_query("UPDATE proposals SET status = 'REJECTED', public_token = NULL, updated_at = %s WHERE id = %s", (core.now_iso(), proposal_id))
    await _note(p, f"Proposal {p['code']} rejected — {reason.strip()}", ctx)
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
    await _note(p, f"Client reply to {p['code']} via link ({who}): {'ACCEPTED' if action == 'accept' else 'asked for changes'}" + (f" — {message}" if message else ""), None, "Email", f"{who} (client)")
    owner = await execute_query("SELECT email FROM users WHERE id = %s", (p["owner_id"],), fetch_one=True)
    if owner and owner["email"]:
        asyncio.get_running_loop().run_in_executor(None, _send_email, [owner["email"]], f"{p['code']}: client {'accepted' if action == 'accept' else 'asked for changes'}",
                                                   _proposal_reply_email_html(p["code"], p["title"], p["client_name"], action, message), "sales")
    return {"message": "Thank you — your reply has been recorded." if action == "accept" else "Thank you — we'll get back to you with the changes.", "reply": response}


# ====================================================================== contracts & engagements

def contract_out(r: dict) -> dict:
    value, cost = D(r["contract_value"]), D(r["estimated_cost"])
    margin = value - cost
    return {"id": r["id"], "code": r["code"], "client_id": r["client_id"], "client_name": r.get("client_name"), "client_email": r.get("client_email"), "proposal_id": r["proposal_id"], "opportunity_id": r.get("opportunity_id"), "contract_no": r["contract_no"],
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
        p = await execute_query("SELECT owner_id FROM proposals WHERE id = %s", (r["proposal_id"],), fetch_one=True) if r["proposal_id"] else None
        o = await execute_query("SELECT owner_id FROM opportunities WHERE id = %s", (r["opportunity_id"],), fetch_one=True) if r.get("opportunity_id") else None
        if not ((p and p["owner_id"] == ctx.uid) or (o and o["owner_id"] == ctx.uid)):
            raise HTTPException(status_code=404, detail="Contract not found")
    return r

async def get_contract(ctx: Ctx, contract_id: int) -> dict:
    return contract_out(await _contract_or_404(ctx, contract_id))

async def list_contracts(ctx: Ctx, *, client_id: int = 0, status: str = "") -> list:
    core.require_any(ctx)
    where, args = [], []
    if ctx.sales == "sales" and not ctx.acct:
        where.append("(k.proposal_id IN (SELECT id FROM proposals WHERE owner_id = %s) OR k.opportunity_id IN (SELECT id FROM opportunities WHERE owner_id = %s))"); args += [ctx.uid, ctx.uid]
    if client_id:
        where.append("k.client_id = %s"); args.append(client_id)
    if status:
        where.append("k.status = %s"); args.append(core.check(status, core.CONTRACT_STATUSES, "status"))
    rows = await execute_query(_CONTRACT_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY k.id DESC LIMIT 500", tuple(args), fetch_all=True)
    return [contract_out(r) for r in (rows or [])]

async def book_po(ctx: Ctx, proposal_id: int, data) -> dict:
    """PO won: only for a SENT proposal whose review is APPROVED. Sets the proposal ACCEPTED, its opportunity Closed Won and creates the contract (DRAFT)."""
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
            """INSERT INTO contracts (code, client_id, proposal_id, opportunity_id, contract_no, po_date, po_reference, contract_value, start_date, end_date, status, estimated_cost, booked_by, created_at, updated_at, scope_of_work)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'DRAFT', %s, %s, %s, %s, %s)""",
            (core.temp_code(), client["id"], proposal_id, p.get("opportunity_id"), (data.contract_no or "").strip() or None, core.clean_date(data.po_date, "PO date") or core.today().isoformat(),
             data.po_reference.strip()[:120], value, start, end, p["total_cost"], ctx.uid, now, now, p.get("scope_of_work") or ""), last_id=True)
    except pymysql.err.IntegrityError:
        raise HTTPException(status_code=409, detail="A PO has already been booked for this proposal")
    await execute_query("UPDATE contracts SET code = %s WHERE id = %s", (core.format_code("CTR", kid), kid))
    await execute_query("UPDATE proposals SET status = 'ACCEPTED', updated_at = %s WHERE id = %s", (now, proposal_id))
    await _close_opportunity_won(ctx, p.get("opportunity_id"), value, f"PO {data.po_reference.strip()} booked on {p['code']} → contract {core.format_code('CTR', kid)}")
    return contract_out(await execute_query(_CONTRACT_SELECT + " WHERE k.id = %s", (kid,), fetch_one=True))

async def _close_opportunity_won(ctx: Ctx, opportunity_id: Optional[int], value, note: str) -> None:
    """A booked PO closes the opportunity as Won (its deal value becomes the contract value) and converts the lead it came from."""
    if not opportunity_id:
        return
    now = core.now_iso()
    await execute_query("UPDATE opportunities SET stage = 'Closed Won', deal_value = %s, closed_at = %s, last_activity_date = %s, updated_at = %s WHERE id = %s",
                        (value, now, core.today().isoformat(), now, opportunity_id))
    opp = await execute_query("SELECT client_id, lead_id FROM opportunities WHERE id = %s", (opportunity_id,), fetch_one=True)
    if opp:
        await execute_query("UPDATE clients SET account_type = 'Active Client' WHERE id = %s AND account_type = 'Prospect'", (opp["client_id"],))
        await _note({"client_id": opp["client_id"], "opportunity_id": opportunity_id, "lead_id": opp["lead_id"]}, note, ctx)

async def book_po_direct(ctx: Ctx, opportunity_id: int, data) -> dict:
    """A Closed Won deal that never went through a proposal in the portal: create its contract straight from the opportunity (manager)."""
    from app.services.cm_crm import opportunity_or_404
    core.require_manager(ctx)
    opp = await opportunity_or_404(ctx, opportunity_id)
    if opp["stage"] != "Closed Won":
        raise HTTPException(status_code=400, detail=f"Mark the opportunity Closed Won first (it is {opp['stage']})")
    if await execute_query("SELECT id FROM contracts WHERE opportunity_id = %s LIMIT 1", (opportunity_id,), fetch_one=True):
        raise HTTPException(status_code=409, detail="A contract already exists for this opportunity")
    if not (data.po_reference or "").strip():
        raise HTTPException(status_code=400, detail="Enter the PO reference")
    start, end = core.clean_date(data.start_date, "Start date"), core.clean_date(data.end_date, "End date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date can't be before the start date")
    value = D(data.contract_value) if data.contract_value is not None else D(opp["deal_value"])
    if value <= 0:
        raise HTTPException(status_code=400, detail="Contract value must be greater than zero (set the deal value or enter it here)")
    now = core.now_iso()
    kid = await execute_query(
        """INSERT INTO contracts (code, client_id, opportunity_id, lead_id, contract_no, po_date, po_reference, contract_value, start_date, end_date, status, estimated_cost, booked_by, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'DRAFT', 0, %s, %s, %s)""",
        (core.temp_code(), opp["client_id"], opportunity_id, opp["lead_id"], (data.contract_no or "").strip() or None, core.clean_date(data.po_date, "PO date") or core.today().isoformat(),
         data.po_reference.strip()[:120], value, start, end, ctx.uid, now, now), last_id=True)
    await execute_query("UPDATE contracts SET code = %s WHERE id = %s", (core.format_code("CTR", kid), kid))
    await _close_opportunity_won(ctx, opportunity_id, value, f"PO {data.po_reference.strip()} booked → contract {core.format_code('CTR', kid)}")
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
    if True:
        await _note(k, f"Contract {k['code']} ACTIVE — engagement {'linked' if linked else 'created'} (project #{project_id})", ctx)
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
    if True:
        await _note(k, f"Contract {k['code']} {data.status}" + (f" — {data.note.strip()}" if data.note.strip() else ""), ctx)
    return await get_contract(ctx, contract_id)
