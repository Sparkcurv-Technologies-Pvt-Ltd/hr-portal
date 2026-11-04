"""Import the Sales CRM workbook (``.xlsx``, or one sheet as ``.csv``) into Client Management.

Each sheet is recognised by its header row (``Lead ID`` / ``Account ID`` / ``Opportunity ID`` / ``Follow-up ID`` / ``Log ID``), so title rows above the headers, the per-BDR copies
("Wincy Leads", ...) and the "Lists" / "Overview" sheets (skipped) all work. Re-running is safe: rows that already exist are skipped, never duplicated.
Preview first (``apply=False``) to see what would happen; nothing is written until ``apply=True``.
"""

import csv
import io
import re
from typing import Optional

from fastapi import HTTPException

from app.db import execute_query
from app.services import cm_core as core
from app.services import cm_crm as crm
from app.services.cm_core import Ctx

MAX_BYTES = 25 * 1024 * 1024
KINDS = {"leadid": "leads", "accountid": "accounts", "opportunityid": "opportunities", "followupid": "followups", "logid": "activity"}
ERROR_LIMIT = 15


def _norm(h) -> str:
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())


def read_sheets(filename: str, data: bytes) -> list:
    """[(sheet name, matrix of rows)] from an .xlsx or .csv upload."""
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="That file is too large (25 MB at most)")
    name = (filename or "").lower()
    if name.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        return [(filename.rsplit(".", 1)[0], [row for row in csv.reader(io.StringIO(text))])]
    if not name.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload the .xlsx workbook (or one sheet as .csv)")
    try:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        return [(ws.title, [list(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets]
    except Exception:
        raise HTTPException(status_code=400, detail="That file couldn't be read as an Excel workbook")


def detect(matrix: list) -> Optional[tuple]:
    """(kind, header row index) — the first of the top rows that holds one of the recognised ID headings."""
    for i, row in enumerate(matrix[:12]):
        for cell in row[:3]:
            kind = KINDS.get(_norm(cell))
            if kind:
                return kind, i
    return None


def _cols(header: list) -> dict:
    """normalised heading -> first column index (the follow-up sheet repeats Date / Outcome, handled by position)."""
    out = {}
    for i, h in enumerate(header):
        out.setdefault(_norm(h), i)
    return out


def _get(row: list, cols: dict, *names):
    for n in names:
        i = cols.get(_norm(n))
        if i is not None and i < len(row) and row[i] not in (None, ""):
            return row[i]
    return None


class _Result:
    def __init__(self, name: str, kind: str, rows: int):
        self.d = {"sheet": name, "kind": kind, "rows": rows, "created": 0, "updated": 0, "skipped": 0, "errors": []}

    def err(self, line: int, msg: str):
        self.d["skipped"] += 1
        if len(self.d["errors"]) < ERROR_LIMIT:
            self.d["errors"].append({"row": line, "reason": msg})


async def import_workbook(ctx: Ctx, filename: str, data: bytes, apply: bool = False, only: Optional[list] = None) -> dict:
    core.require_manager(ctx)
    sheets = read_sheets(filename, data)
    results = []
    users = {}
    for name, matrix in sheets:
        found = detect(matrix)
        if not found:
            results.append({"sheet": name, "kind": None, "rows": 0, "created": 0, "updated": 0, "skipped": 0, "errors": [], "note": "Not a CRM sheet (no Lead / Account / Opportunity / Follow-up / Log heading) — skipped"})
            continue
        kind, hdr = found
        body = [r for r in matrix[hdr + 1:] if any(c not in (None, "") for c in r)]
        if only is not None and name not in only:
            results.append({"sheet": name, "kind": kind, "rows": len(body), "created": 0, "updated": 0, "skipped": 0, "errors": [], "note": "Not selected"})
            continue
        res = _Result(name, kind, len(body))
        await {"leads": _leads, "accounts": _accounts, "opportunities": _opportunities, "followups": _followups, "activity": _activity}[kind](ctx, matrix[hdr], body, res, apply, users)
        results.append(res.d)
    order = {"accounts": 0, "leads": 1, "opportunities": 2, "followups": 3, "activity": 4}
    results.sort(key=lambda r: order.get(r["kind"], 9))
    return {"applied": apply, "filename": filename, "sheets": results}


async def _owner(label, users: dict) -> tuple:
    """(user id or None, label text) for a BDR / owner name, remembering lookups."""
    t = crm._text(label, 100)
    if not t:
        return None, None
    key = t.lower()
    if key not in users:
        users[key] = await crm.resolve_user(t)
    return users[key], t


# ---------------------------------------------------------------- accounts

async def _accounts(ctx, header, body, res, apply, users):
    cols = _cols(header)
    pending = set()                                  # companies this run would create (a preview must not count a repeated company twice)
    for n, row in enumerate(body, 1):
        name = crm._text(_get(row, cols, "Company Name"), 200)
        if not name:
            res.err(n, "No company name"); continue
        oid, olabel = await _owner(_get(row, cols, "Account Owner"), users)
        industry = crm._canon(_get(row, cols, "Industry"), core.INDUSTRIES)
        if _get(row, cols, "Industry") and not industry:
            industry = "Other"
        fields = {"industry": industry, "location": crm._text(_get(row, cols, "Location"), 200), "website": crm._text(_get(row, cols, "Website"), 255),
                  "contact_person": crm._text(_get(row, cols, "Primary Contact"), 200), "phone": crm._text(_get(row, cols, "Phone"), 50), "email": crm._text(_get(row, cols, "Email"), 255),
                  "account_type": crm._canon(_get(row, cols, "Account Type"), core.ACCOUNT_TYPES, "Prospect"), "owner_id": oid, "owner_label": olabel if not oid else None,
                  "notes": crm._text(_get(row, cols, "Notes"))}
        created_on = crm.parse_date(_get(row, cols, "Created Date"))
        existing = await crm.account_by_name(name)
        if not existing and name.lower() in pending:
            res.d["skipped"] += 1; continue
        pending.add(name.lower())
        if existing:
            fill = {k: v for k, v in fields.items() if v and not existing.get(k) and k not in ("account_type",)}
            if fill:
                if apply:
                    await execute_query(f"UPDATE clients SET {', '.join(f'{k} = %s' for k in fill)} WHERE id = %s", (*fill.values(), existing["id"]))
                res.d["updated"] += 1
            else:
                res.d["skipped"] += 1
            continue
        if apply:
            await crm.ensure_account(ctx, name, created_at=(created_on + "T00:00:00+00:00") if created_on else None, **fields)
        res.d["created"] += 1


# ---------------------------------------------------------------- leads

async def _leads(ctx, header, body, res, apply, users):
    cols = _cols(header)
    seen = {(r["c"], r["p"] or "", r["e"] or "") for r in (await execute_query("SELECT LOWER(COALESCE(company_name, '')) AS c, phone_norm AS p, email_norm AS e FROM leads", fetch_all=True) or [])}
    for n, row in enumerate(body, 1):
        company = crm._text(_get(row, cols, "Company Name"), 200)
        phone, email = crm._text(_get(row, cols, "Phone"), 40), crm._text(_get(row, cols, "Email"), 255)
        if email and not core.valid_email(email):
            email = None
        contact = crm._text(_get(row, cols, "Contact Person"), 200)
        if not (company or phone or email):
            res.err(n, "No company, phone or email"); continue
        key = ((company or "").lower(), core.norm_phone(phone) or "", core.norm_email(email) or "")
        if key in seen:
            res.d["skipped"] += 1; continue
        seen.add(key)
        oid, olabel = await _owner(_get(row, cols, "BDR Name"), users)
        status = crm._canon(_get(row, cols, "Lead Status"), core.LEAD_STATUSES, "New")
        fields = {"company_name": company, "contact_name": contact, "phone": phone, "email": email, "location": crm._text(_get(row, cols, "Location"), 200),
                  "source": crm._canon(_get(row, cols, "Lead Source"), core.LEAD_SOURCES, "Other"), "lead_status": status,
                  "date_added": crm.parse_date(_get(row, cols, "Date Added")), "interested_in": crm._text(_get(row, cols, "Interested In / Notes")), "next_action": crm._text(_get(row, cols, "Next Action"), 500)}
        if apply:
            await crm._insert_lead(fields, oid, olabel if not oid else None, ctx.uid)
        res.d["created"] += 1


# ---------------------------------------------------------------- opportunities

async def _opportunities(ctx, header, body, res, apply, users):
    cols = _cols(header)
    seen = {(r["c"], (r["n"] or "").lower()) for r in (await execute_query("SELECT client_id AS c, opp_name AS n FROM opportunities", fetch_all=True) or [])}
    seen_names = set()
    for n, row in enumerate(body, 1):
        company = crm._text(_get(row, cols, "Company Name"), 200)
        if not company:
            res.err(n, "No company name"); continue
        stage = crm._canon(_get(row, cols, "Stage"), core.OPP_STAGES, "Discovery")
        name = crm._text(_get(row, cols, "Opp Name"), 255) or company
        acc = await crm.account_by_name(company)
        if (acc and (acc["id"], name.lower()) in seen) or (company.lower(), name.lower()) in seen_names:
            res.d["skipped"] += 1; continue
        seen_names.add((company.lower(), name.lower()))
        oid, olabel = await _owner(_get(row, cols, "BDR Name"), users)
        if apply:
            if not acc:
                acc, _ = await crm.ensure_account(ctx, company, owner_id=oid, owner_label=olabel if not oid else None)
            await crm._insert_opportunity(ctx, acc["id"], opp_name=name, contact_person=_get(row, cols, "Contact Person"), stage=stage, deal_value=crm.parse_money(_get(row, cols, "Deal Value (INR)")),
                                          expected_close_date=crm.parse_date(_get(row, cols, "Expected Close Date")), lead_source=crm._canon(_get(row, cols, "Lead Source"), core.LEAD_SOURCES),
                                          owner_id=oid, bdr_label=olabel if not oid else None, created_date=crm.parse_date(_get(row, cols, "Created Date")),
                                          last_activity_date=crm.parse_date(_get(row, cols, "Last Activity Date")), next_action=_get(row, cols, "Next Action"), notes=crm._text(_get(row, cols, "Notes")))
            seen.add((acc["id"], name.lower()))
        res.d["created"] += 1


# ---------------------------------------------------------------- follow-ups

async def _followups(ctx, header, body, res, apply, users):
    cols = _cols(header)
    first_pair = 5                                   # Follow-up ID, Company Name, Contact Person, BDR Name, Opportunity Stage (ref), then Date / Outcome pairs
    seen = {(r["c"], r["o"] or "") for r in (await execute_query("SELECT LOWER(company_name) AS c, COALESCE(bdr_label, CAST(owner_id AS CHAR)) AS o FROM followups", fetch_all=True) or [])}
    for n, row in enumerate(body, 1):
        company = crm._text(_get(row, cols, "Company Name"), 255)
        if not company:
            res.err(n, "No company name"); continue
        oid, olabel = await _owner(_get(row, cols, "BDR Name"), users)
        key = (company.lower(), str(oid) if oid else (olabel or ""))
        if key in seen:
            res.d["skipped"] += 1; continue
        seen.add(key)
        if apply:
            acc = await crm.account_by_name(company)
            opp = await execute_query("SELECT id FROM opportunities WHERE client_id = %s ORDER BY id DESC LIMIT 1", (acc["id"],), fetch_one=True) if acc else None
            now = core.now_iso()
            fid = await execute_query(
                "INSERT INTO followups (code, client_id, opportunity_id, company_name, contact_person, owner_id, bdr_label, notes, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (core.temp_code(), acc["id"] if acc else None, opp["id"] if opp else None, company, crm._text(_get(row, cols, "Contact Person"), 200), oid, olabel if not oid else None,
                 crm._text(_get(row, cols, "Notes")), now, now), last_id=True)
            await execute_query("UPDATE followups SET code = %s WHERE id = %s", (core.format_code("F", fid), fid))
            for step in range(len(core.CADENCE)):
                di, oi = first_pair + step * 2, first_pair + step * 2 + 1
                d = crm.parse_date(row[di]) if di < len(row) else None
                outcome = crm._canon(row[oi], core.FOLLOWUP_OUTCOMES) if oi < len(row) else None
                if d or outcome:
                    await execute_query("INSERT INTO followup_steps (followup_id, step_no, step_date, outcome) VALUES (%s, %s, %s, %s)", (fid, step + 1, d, outcome))
        res.d["created"] += 1


# ---------------------------------------------------------------- activity log

async def _activity(ctx, header, body, res, apply, users):
    cols = _cols(header)
    seen = {(r["d"], (r["b"] or "").lower(), r["c"], r["t"], r["o"] or "", (r["n"] or "").strip()) for r in (await execute_query(
        "SELECT log_date AS d, LOWER(COALESCE(bdr_label, '')) AS b, LOWER(company_name) AS c, activity_type AS t, outcome AS o, notes AS n FROM activity_log", fetch_all=True) or [])}
    for n, row in enumerate(body, 1):
        company = crm._text(_get(row, cols, "Company Name"), 255)
        kind = crm._canon(_get(row, cols, "Activity Type"), core.ACTIVITY_TYPES)
        d = crm.parse_date(_get(row, cols, "Date"))
        if not (company and kind and d):
            res.err(n, "Needs a date, company and activity type (Email / Call / WhatsApp)"); continue
        oid, olabel = await _owner(_get(row, cols, "BDR Name"), users)
        outcome = crm._canon(_get(row, cols, "Outcome"), core.FOLLOWUP_OUTCOMES)
        notes = crm._text(_get(row, cols, "Notes")) or ""
        owner_name = None
        if oid:
            u = await execute_query("SELECT name FROM users WHERE id = %s", (oid,), fetch_one=True)
            owner_name = u["name"] if u else None
        key = (d, (owner_name or olabel or "").lower(), company.lower(), kind, outcome or "", notes.strip())
        if key in seen:
            res.d["skipped"] += 1; continue
        seen.add(key)
        if apply:
            acc = await crm.account_by_name(company)
            await core.log_activity(acc["name"] if acc else company, notes, activity_type=kind, outcome=outcome, ctx=ctx, owner_id=oid, bdr_label=owner_name or olabel, client_id=acc["id"] if acc else None, log_date=d)
        res.d["created"] += 1
