"""Client Management — accounts side: invoices (draft → posted → reversed), month-end drafting, client payments and allocations, advances,
the client ledger, and KPIs.

Rules: nothing reaches the ledger until it is POSTED. Posted documents are never edited or deleted — they are cancelled (reversed) with a
reason, which releases any payment allocations or advance adjustments made against them.
"""

import asyncio
import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException

from app.core.config import APP_TIMEZONE, CLIENT_MGMT_DEFAULT_TAX_PCT, CLIENT_MGMT_MONTH_END_ENABLED
from app.core.log import logger
from app.db import execute_query
from app.services import cm_core as core
from app.services.cm_core import D, F, Ctx


# ====================================================================== invoice maths

def cumulative_billable(contract: dict, as_of: date) -> Decimal:
    """Contract value earned up to ``as_of``: accrued evenly from start to end date; the whole value once the end date is reached or when there is no end date (lump sum)."""
    value = D(contract["contract_value"])
    if not contract["start_date"]:
        return D(0)
    start = date.fromisoformat(contract["start_date"])
    if as_of < start:
        return D(0)
    if not contract["end_date"]:
        return value
    end = date.fromisoformat(contract["end_date"])
    if as_of >= end:
        return value
    total_days, elapsed = (end - start).days + 1, (as_of - start).days + 1
    return (value * Decimal(elapsed) / Decimal(total_days)).quantize(core.CENT)

def period_end(period: str) -> date:
    y, m = int(period[:4]), int(period[5:7])
    return date(y, m, calendar.monthrange(y, m)[1])

def compute_amounts(gross, tax_pct, tds_pct, retention_pct) -> dict:
    g = D(gross)
    tax, tds, ret = core.pct(g, tax_pct), core.pct(g, tds_pct), core.pct(g, retention_pct)
    return {"gross_amount": g, "tax_amount": tax, "tds_amount": tds, "retention_amount": ret, "net_amount": g + tax - tds - ret}

async def posted_gross(contract_id: int, exclude_invoice_id: int = 0) -> Decimal:
    r = await execute_query("SELECT COALESCE(SUM(gross_amount), 0) AS s FROM invoices WHERE contract_id = %s AND status = 'POSTED' AND id != %s", (contract_id, exclude_invoice_id), fetch_one=True)
    return D(r["s"])

async def _contract(contract_id: int) -> dict:
    k = await execute_query("SELECT * FROM contracts WHERE id = %s", (contract_id,), fetch_one=True)
    if not k:
        raise HTTPException(status_code=404, detail="Contract not found")
    return k

async def invoice_suggestion(ctx: Ctx, contract_id: int, period: str) -> dict:
    """Suggested gross for a period = cumulative billable value up to the end of that month − what is already posted (never below zero)."""
    core.require_accounts_read(ctx)
    period = core.clean_period(period)
    k = await _contract(contract_id)
    client = await core.client_or_404(k["client_id"])
    as_of = period_end(period)
    cumulative, posted = cumulative_billable(k, as_of), await posted_gross(contract_id)
    suggested = max(cumulative - posted, D(0))
    defaults = {"tax_pct": CLIENT_MGMT_DEFAULT_TAX_PCT, "tds_pct": float(client["default_tds_pct"] or 0), "retention_pct": float(client["default_retention_pct"] or 0)}
    amounts = compute_amounts(suggested, defaults["tax_pct"], defaults["tds_pct"], defaults["retention_pct"])
    return {"contract_id": contract_id, "period": period, "as_of": as_of.isoformat(), "contract_value": F(k["contract_value"]), "cumulative_billable": F(cumulative), "already_posted": F(posted),
            "suggested_gross": F(suggested), **defaults, **{k2: F(v) for k2, v in amounts.items()}}


# ====================================================================== invoices

def invoice_out(r: dict, outstanding: Optional[Decimal] = None) -> dict:
    out = {"id": r["id"], "code": r["code"], "contract_id": r["contract_id"], "client_id": r["client_id"], "client_name": r.get("client_name"), "contract_code": r.get("contract_code"),
           "period": r["period"], "invoice_date": r["invoice_date"], "gross_amount": F(r["gross_amount"]), "tax_pct": float(r["tax_pct"]), "tax_amount": F(r["tax_amount"]),
           "tds_pct": float(r["tds_pct"]), "tds_amount": F(r["tds_amount"]), "retention_pct": float(r["retention_pct"]), "retention_amount": F(r["retention_amount"]),
           "net_amount": F(r["net_amount"]), "status": r["status"], "generated_by": r["generated_by"], "notes": r["notes"], "created_at": r["created_at"], "posted_at": r["posted_at"],
           "cancelled_at": r["cancelled_at"], "cancel_reason": r["cancel_reason"],
           "emailed_at": r.get("emailed_at"), "emailed_to": r.get("emailed_to")}
    if outstanding is not None:
        out["outstanding"] = F(outstanding)
    return out

_INVOICE_SELECT = "SELECT i.*, c.name AS client_name, k.code AS contract_code FROM invoices i JOIN clients c ON c.id = i.client_id JOIN contracts k ON k.id = i.contract_id"

async def invoice_outstanding(invoice: dict) -> Decimal:
    if invoice["status"] != "POSTED":
        return D(0)
    a = await execute_query("SELECT COALESCE(SUM(amount), 0) AS s FROM payment_allocations WHERE invoice_id = %s AND released_at IS NULL", (invoice["id"],), fetch_one=True)
    b = await execute_query("SELECT COALESCE(SUM(amount), 0) AS s FROM advance_adjustments WHERE invoice_id = %s AND released_at IS NULL", (invoice["id"],), fetch_one=True)
    return D(invoice["net_amount"]) - D(a["s"]) - D(b["s"])

async def _invoice_or_404(invoice_id: int) -> dict:
    r = await execute_query(_INVOICE_SELECT + " WHERE i.id = %s", (invoice_id,), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return r

async def get_invoice(ctx: Ctx, invoice_id: int) -> dict:
    core.require_accounts_read(ctx)
    r = await _invoice_or_404(invoice_id)
    return invoice_out(r, await invoice_outstanding(r))

async def list_invoices(ctx: Ctx, *, client_id: int = 0, contract_id: int = 0, status: str = "", period: str = "") -> list:
    core.require_accounts_read(ctx)
    where, args = [], []
    for col, val in (("i.client_id", client_id), ("i.contract_id", contract_id)):
        if val:
            where.append(f"{col} = %s"); args.append(val)
    if status:
        where.append("i.status = %s"); args.append(core.check(status, core.INVOICE_STATUSES, "status"))
    if period:
        where.append("i.period = %s"); args.append(core.clean_period(period))
    rows = await execute_query(_INVOICE_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY i.id DESC LIMIT 1000", tuple(args), fetch_all=True)
    return [invoice_out(r, await invoice_outstanding(r)) for r in (rows or [])]

async def _insert_invoice(contract: dict, client: dict, period: str, gross, tax_pct, tds_pct, retention_pct, invoice_date, notes, generated_by: str, created_by: Optional[int]) -> int:
    amounts = compute_amounts(gross, tax_pct, tds_pct, retention_pct)
    iid = await execute_query(
        """INSERT INTO invoices (code, contract_id, client_id, period, invoice_date, gross_amount, tax_pct, tax_amount, tds_pct, tds_amount, retention_pct, retention_amount, net_amount,
                                 status, generated_by, notes, created_by, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'DRAFT', %s, %s, %s, %s)""",
        (core.temp_code(), contract["id"], client["id"], period, invoice_date, amounts["gross_amount"], tax_pct, amounts["tax_amount"], tds_pct, amounts["tds_amount"], retention_pct,
         amounts["retention_amount"], amounts["net_amount"], generated_by, notes, created_by, core.now_iso()), last_id=True)
    await execute_query("UPDATE invoices SET code = %s WHERE id = %s", (core.format_code("INV", iid), iid))
    return iid

async def _period_taken(contract_id: int, period: str, exclude_id: int = 0) -> bool:
    return bool(await execute_query("SELECT id FROM invoices WHERE contract_id = %s AND period = %s AND status != 'CANCELLED' AND id != %s LIMIT 1", (contract_id, period, exclude_id), fetch_one=True))

async def create_invoice(ctx: Ctx, data) -> dict:
    core.require_accounts(ctx)
    period = core.clean_period(data.period)
    k = await _contract(data.contract_id)
    if k["status"] not in ("ACTIVE", "COMPLETED"):
        raise HTTPException(status_code=400, detail=f"Invoices can only be raised on an ACTIVE or COMPLETED contract (this one is {k['status']})")
    if await _period_taken(k["id"], period):
        raise HTTPException(status_code=409, detail=f"This contract already has an invoice for {period} — cancel it first to raise another")
    client = await core.client_or_404(k["client_id"])
    sug = await invoice_suggestion(ctx, k["id"], period)
    gross = data.gross_amount if data.gross_amount is not None else sug["suggested_gross"]
    if D(gross) <= 0:
        raise HTTPException(status_code=400, detail="Nothing to bill for this period — the invoice amount must be greater than zero")
    tax = core.check_pct(data.tax_pct if data.tax_pct is not None else sug["tax_pct"], "Tax %")
    tds = core.check_pct(data.tds_pct if data.tds_pct is not None else sug["tds_pct"], "TDS %")
    ret = core.check_pct(data.retention_pct if data.retention_pct is not None else sug["retention_pct"], "Retention %")
    iid = await _insert_invoice(k, client, period, gross, tax, tds, ret, core.clean_date(data.invoice_date, "Invoice date"), data.notes, "MANUAL", ctx.uid)
    return await get_invoice(ctx, iid)

async def update_invoice(ctx: Ctx, invoice_id: int, data) -> dict:
    core.require_accounts(ctx)
    inv = await _invoice_or_404(invoice_id)
    if inv["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail=f"A {inv['status']} invoice can't be edited — cancel it with a reason and raise a new one")
    changes = {k: v for k, v in data.model_dump().items() if k in data.model_fields_set}
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    gross = changes.get("gross_amount", inv["gross_amount"])
    if D(gross) <= 0:
        raise HTTPException(status_code=400, detail="The invoice amount must be greater than zero")
    tax = core.check_pct(changes.get("tax_pct", inv["tax_pct"]), "Tax %")
    tds = core.check_pct(changes.get("tds_pct", inv["tds_pct"]), "TDS %")
    ret = core.check_pct(changes.get("retention_pct", inv["retention_pct"]), "Retention %")
    a = compute_amounts(gross, tax, tds, ret)
    await execute_query(
        "UPDATE invoices SET gross_amount = %s, tax_pct = %s, tax_amount = %s, tds_pct = %s, tds_amount = %s, retention_pct = %s, retention_amount = %s, net_amount = %s, invoice_date = %s, notes = %s WHERE id = %s",
        (a["gross_amount"], tax, a["tax_amount"], tds, a["tds_amount"], ret, a["retention_amount"], a["net_amount"], core.clean_date(changes.get("invoice_date", inv["invoice_date"]), "Invoice date"), changes.get("notes", inv["notes"]), invoice_id))
    return await get_invoice(ctx, invoice_id)

async def delete_invoice(ctx: Ctx, invoice_id: int) -> None:
    core.require_accounts(ctx)
    inv = await _invoice_or_404(invoice_id)
    if inv["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail="Only a DRAFT invoice can be deleted; a posted one is cancelled with a reason")
    await execute_query("DELETE FROM invoices WHERE id = %s AND status = 'DRAFT'", (invoice_id,))

async def post_invoice(ctx: Ctx, invoice_id: int) -> dict:
    """DRAFT → POSTED. The amount may not push the contract past what has been earned so far; once posted it is final."""
    core.require_accounts(ctx)
    inv = await _invoice_or_404(invoice_id)
    if inv["status"] != "DRAFT":
        raise HTTPException(status_code=409, detail=f"This invoice is already {inv['status']}")
    k = await _contract(inv["contract_id"])
    allowed = cumulative_billable(k, period_end(inv["period"])) - await posted_gross(k["id"], exclude_invoice_id=inv["id"])
    if D(inv["gross_amount"]) > max(allowed, D(0)):
        raise HTTPException(status_code=400, detail=f"The invoice ({F(inv['gross_amount'])}) is more than can be billed for {inv['period']} ({F(max(allowed, D(0)))}) — reduce it or raise it later")
    today = core.today().isoformat()
    claimed = await execute_query("UPDATE invoices SET status = 'POSTED', posted_by = %s, posted_at = %s, invoice_date = COALESCE(invoice_date, %s) WHERE id = %s AND status = 'DRAFT'", (ctx.uid, core.now_iso(), today, invoice_id))
    if claimed != 1:
        raise HTTPException(status_code=409, detail="This invoice was just posted by someone else")
    return await get_invoice(ctx, invoice_id)

async def cancel_invoice(ctx: Ctx, invoice_id: int, reason: str) -> dict:
    """Reverse a posted invoice (reason required): it leaves the ledger and every payment allocation / advance adjustment against it is released."""
    core.require_accounts(ctx)
    inv = await _invoice_or_404(invoice_id)
    if inv["status"] != "POSTED":
        raise HTTPException(status_code=400, detail="Only a POSTED invoice can be cancelled (a draft is simply deleted)")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for cancelling")
    now = core.now_iso()
    claimed = await execute_query("UPDATE invoices SET status = 'CANCELLED', cancelled_by = %s, cancelled_at = %s, cancel_reason = %s WHERE id = %s AND status = 'POSTED'", (ctx.uid, now, reason.strip(), invoice_id))
    if claimed != 1:
        raise HTTPException(status_code=409, detail="This invoice was just changed by someone else")
    await execute_query("UPDATE payment_allocations SET released_at = %s WHERE invoice_id = %s AND released_at IS NULL", (now, invoice_id))
    adjusted = await execute_query("SELECT DISTINCT advance_id FROM advance_adjustments WHERE invoice_id = %s AND released_at IS NULL", (invoice_id,), fetch_all=True)
    await execute_query("UPDATE advance_adjustments SET released_at = %s WHERE invoice_id = %s AND released_at IS NULL", (now, invoice_id))
    for a in (adjusted or []):
        await _refresh_advance_status(a["advance_id"])
    return await get_invoice(ctx, invoice_id)


# ---------- month-end ----------

async def run_month_end(ctx: Optional[Ctx], month: Optional[str] = None) -> dict:
    """Draft one invoice per eligible ACTIVE contract for the month (nothing posts). Safe to run repeatedly: a contract/period that already has a live invoice is skipped."""
    if ctx is not None:
        core.require_accounts(ctx)
    period = core.clean_period(month) if month else core.today().strftime("%Y-%m")
    end = period_end(period)
    contracts = await execute_query("SELECT * FROM contracts WHERE status = 'ACTIVE' ORDER BY id", fetch_all=True)
    created, skipped = [], []
    for k in (contracts or []):
        if not k["start_date"] or k["start_date"] > end.isoformat():
            skipped.append({"contract": k["code"], "reason": "not started yet"}); continue
        if await _period_taken(k["id"], period):
            skipped.append({"contract": k["code"], "reason": "already has an invoice for this period"}); continue
        suggested = max(cumulative_billable(k, end) - await posted_gross(k["id"]), D(0))
        if suggested <= 0:
            skipped.append({"contract": k["code"], "reason": "nothing to bill"}); continue
        client = await core.client_or_404(k["client_id"])
        iid = await _insert_invoice(k, client, period, suggested, CLIENT_MGMT_DEFAULT_TAX_PCT, float(client["default_tds_pct"] or 0), float(client["default_retention_pct"] or 0), None,
                                    "Drafted by the month-end run", "MONTH_END", ctx.uid if ctx else None)
        created.append({"contract": k["code"], "invoice_id": iid, "invoice": core.format_code("INV", iid), "gross_amount": F(suggested)})
    return {"period": period, "created": created, "skipped": skipped}

async def _month_end_loop() -> None:
    while True:
        try:
            local = datetime.now(timezone.utc).astimezone(APP_TIMEZONE)
            if local.day == calendar.monthrange(local.year, local.month)[1] and local.hour >= 6:
                result = await run_month_end(None)
                if result["created"]:
                    logger.info(f"Month-end invoices drafted for {result['period']}: {[c['invoice'] for c in result['created']]}")
        except Exception as e:
            logger.warning(f"Month-end invoice run failed: {e}")
        await asyncio.sleep(3600)

def start_month_end_scheduler() -> None:
    if CLIENT_MGMT_MONTH_END_ENABLED:
        asyncio.create_task(_month_end_loop())
        logger.info("Client management month-end invoice drafting started (last day of each month)")


# ====================================================================== payments

def payment_out(r: dict, allocated: Optional[Decimal] = None) -> dict:
    out = {"id": r["id"], "code": r["code"], "client_id": r["client_id"], "client_name": r.get("client_name"), "amount": F(r["amount"]), "payment_date": r["payment_date"], "reference": r["reference"],
           "status": r["status"], "notes": r["notes"], "created_at": r["created_at"], "posted_at": r["posted_at"], "cancelled_at": r["cancelled_at"], "cancel_reason": r["cancel_reason"]}
    if allocated is not None:
        out["allocated"] = F(allocated)
        out["unallocated"] = F(D(r["amount"]) - allocated) if r["status"] == "POSTED" else 0.0
    return out

_PAYMENT_SELECT = "SELECT p.*, c.name AS client_name FROM client_payments p JOIN clients c ON c.id = p.client_id"

async def _payment_or_404(payment_id: int) -> dict:
    r = await execute_query(_PAYMENT_SELECT + " WHERE p.id = %s", (payment_id,), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Payment not found")
    return r

async def _allocated(payment_id: int) -> Decimal:
    r = await execute_query("SELECT COALESCE(SUM(amount), 0) AS s FROM payment_allocations WHERE payment_id = %s AND released_at IS NULL", (payment_id,), fetch_one=True)
    return D(r["s"])

async def get_payment(ctx: Ctx, payment_id: int) -> dict:
    core.require_accounts_read(ctx)
    p = await _payment_or_404(payment_id)
    out = payment_out(p, await _allocated(payment_id))
    out["allocations"] = [{"invoice_id": a["invoice_id"], "amount": F(a["amount"]), "released": a["released_at"] is not None} for a in (await execute_query("SELECT * FROM payment_allocations WHERE payment_id = %s ORDER BY id", (payment_id,), fetch_all=True) or [])]
    return out

async def list_payments(ctx: Ctx, client_id: int = 0, status: str = "") -> list:
    core.require_accounts_read(ctx)
    where, args = [], []
    if client_id:
        where.append("p.client_id = %s"); args.append(client_id)
    if status:
        where.append("p.status = %s"); args.append(core.check(status, core.PAYMENT_STATUSES, "status"))
    rows = await execute_query(_PAYMENT_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY p.id DESC LIMIT 1000", tuple(args), fetch_all=True)
    return [payment_out(r, await _allocated(r["id"])) for r in (rows or [])]

async def create_payment(ctx: Ctx, data) -> dict:
    core.require_accounts(ctx)
    await core.client_or_404(data.client_id)
    if D(data.amount) <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    pid = await execute_query("INSERT INTO client_payments (code, client_id, amount, payment_date, reference, status, notes, created_by, created_at) VALUES (%s, %s, %s, %s, %s, 'DRAFT', %s, %s, %s)",
                              (core.temp_code(), data.client_id, D(data.amount), core.clean_date(data.payment_date, "Payment date"), data.reference, data.notes, ctx.uid, core.now_iso()), last_id=True)
    await execute_query("UPDATE client_payments SET code = %s WHERE id = %s", (core.format_code("PAY", pid), pid))
    return await get_payment(ctx, pid)

async def _allocate(ctx: Ctx, payment: dict, allocations: list) -> None:
    if payment["status"] != "POSTED":
        raise HTTPException(status_code=400, detail="Only a POSTED payment can be allocated")
    if not allocations:
        raise HTTPException(status_code=400, detail="Choose at least one invoice")
    free = D(payment["amount"]) - await _allocated(payment["id"])
    plan = {}
    for a in allocations:
        if D(a.amount) <= 0:
            raise HTTPException(status_code=400, detail="Allocation amounts must be greater than zero")
        plan[a.invoice_id] = plan.get(a.invoice_id, D(0)) + D(a.amount)
    if sum(plan.values(), D(0)) > free:
        raise HTTPException(status_code=400, detail=f"That is more than the payment's unallocated balance ({F(free)})")
    for invoice_id, amount in plan.items():
        inv = await _invoice_or_404(invoice_id)
        if inv["client_id"] != payment["client_id"]:
            raise HTTPException(status_code=400, detail=f"Invoice {inv['code']} belongs to a different client")
        if inv["status"] != "POSTED":
            raise HTTPException(status_code=400, detail=f"Invoice {inv['code']} is {inv['status']} — only posted invoices can be paid")
        out = await invoice_outstanding(inv)
        if amount > out:
            raise HTTPException(status_code=400, detail=f"Invoice {inv['code']} only has {F(out)} outstanding")
    now = core.now_iso()
    for invoice_id, amount in plan.items():
        await execute_query("INSERT INTO payment_allocations (payment_id, invoice_id, amount, created_by, created_at) VALUES (%s, %s, %s, %s, %s)", (payment["id"], invoice_id, amount, ctx.uid, now))

async def post_payment(ctx: Ctx, payment_id: int, allocations: Optional[list] = None) -> dict:
    core.require_accounts(ctx)
    p = await _payment_or_404(payment_id)
    if p["status"] != "DRAFT":
        raise HTTPException(status_code=409, detail=f"This payment is already {p['status']}")
    claimed = await execute_query("UPDATE client_payments SET status = 'POSTED', posted_by = %s, posted_at = %s WHERE id = %s AND status = 'DRAFT'", (ctx.uid, core.now_iso(), payment_id))
    if claimed != 1:
        raise HTTPException(status_code=409, detail="This payment was just posted by someone else")
    if allocations:
        try:
            await _allocate(ctx, await _payment_or_404(payment_id), allocations)
        except HTTPException:
            await execute_query("UPDATE client_payments SET status = 'DRAFT', posted_by = NULL, posted_at = NULL WHERE id = %s", (payment_id,))   # nothing half-done
            raise
    return await get_payment(ctx, payment_id)

async def allocate_payment(ctx: Ctx, payment_id: int, allocations: list) -> dict:
    core.require_accounts(ctx)
    await _allocate(ctx, await _payment_or_404(payment_id), allocations)
    return await get_payment(ctx, payment_id)

async def cancel_payment(ctx: Ctx, payment_id: int, reason: str) -> dict:
    core.require_accounts(ctx)
    p = await _payment_or_404(payment_id)
    if p["status"] != "POSTED":
        raise HTTPException(status_code=400, detail="Only a POSTED payment can be cancelled (a draft is deleted)")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for cancelling")
    now = core.now_iso()
    if await execute_query("UPDATE client_payments SET status = 'CANCELLED', cancelled_by = %s, cancelled_at = %s, cancel_reason = %s WHERE id = %s AND status = 'POSTED'", (ctx.uid, now, reason.strip(), payment_id)) != 1:
        raise HTTPException(status_code=409, detail="This payment was just changed by someone else")
    await execute_query("UPDATE payment_allocations SET released_at = %s WHERE payment_id = %s AND released_at IS NULL", (now, payment_id))
    return await get_payment(ctx, payment_id)

async def delete_payment(ctx: Ctx, payment_id: int) -> None:
    core.require_accounts(ctx)
    p = await _payment_or_404(payment_id)
    if p["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail="Only a DRAFT payment can be deleted; a posted one is cancelled with a reason")
    await execute_query("DELETE FROM client_payments WHERE id = %s AND status = 'DRAFT'", (payment_id,))


# ====================================================================== advances

async def _adjusted(advance_id: int) -> Decimal:
    r = await execute_query("SELECT COALESCE(SUM(amount), 0) AS s FROM advance_adjustments WHERE advance_id = %s AND released_at IS NULL", (advance_id,), fetch_one=True)
    return D(r["s"])

async def _refresh_advance_status(advance_id: int) -> None:
    a = await execute_query("SELECT amount, status FROM client_advances WHERE id = %s", (advance_id,), fetch_one=True)
    if not a or a["status"] == "CANCELLED":
        return
    used = await _adjusted(advance_id)
    status = "ADJUSTED" if used >= D(a["amount"]) else "PARTLY_ADJUSTED" if used > 0 else "OPEN"
    await execute_query("UPDATE client_advances SET status = %s WHERE id = %s", (status, advance_id))

def advance_out(r: dict, adjusted: Optional[Decimal] = None) -> dict:
    out = {"id": r["id"], "code": r["code"], "client_id": r["client_id"], "client_name": r.get("client_name"), "amount": F(r["amount"]), "advance_date": r["advance_date"], "reference": r["reference"],
           "status": r["status"], "notes": r["notes"], "created_at": r["created_at"], "cancelled_at": r["cancelled_at"], "cancel_reason": r["cancel_reason"]}
    if adjusted is not None:
        out["adjusted"] = F(adjusted)
        out["remaining"] = F(D(r["amount"]) - adjusted) if r["status"] != "CANCELLED" else 0.0
    return out

_ADVANCE_SELECT = "SELECT a.*, c.name AS client_name FROM client_advances a JOIN clients c ON c.id = a.client_id"

async def _advance_or_404(advance_id: int) -> dict:
    r = await execute_query(_ADVANCE_SELECT + " WHERE a.id = %s", (advance_id,), fetch_one=True)
    if not r:
        raise HTTPException(status_code=404, detail="Advance not found")
    return r

async def get_advance(ctx: Ctx, advance_id: int) -> dict:
    core.require_accounts_read(ctx)
    return advance_out(await _advance_or_404(advance_id), await _adjusted(advance_id))

async def list_advances(ctx: Ctx, client_id: int = 0, status: str = "") -> list:
    core.require_accounts_read(ctx)
    where, args = [], []
    if client_id:
        where.append("a.client_id = %s"); args.append(client_id)
    if status:
        where.append("a.status = %s"); args.append(core.check(status, core.ADVANCE_STATUSES, "status"))
    rows = await execute_query(_ADVANCE_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY a.id DESC LIMIT 1000", tuple(args), fetch_all=True)
    return [advance_out(r, await _adjusted(r["id"])) for r in (rows or [])]

async def create_advance(ctx: Ctx, data) -> dict:
    core.require_accounts(ctx)
    await core.client_or_404(data.client_id)
    if D(data.amount) <= 0:
        raise HTTPException(status_code=400, detail="Advance amount must be greater than zero")
    aid = await execute_query("INSERT INTO client_advances (code, client_id, amount, advance_date, reference, status, notes, created_by, created_at) VALUES (%s, %s, %s, %s, %s, 'OPEN', %s, %s, %s)",
                              (core.temp_code(), data.client_id, D(data.amount), core.clean_date(data.advance_date, "Advance date"), data.reference, data.notes, ctx.uid, core.now_iso()), last_id=True)
    await execute_query("UPDATE client_advances SET code = %s WHERE id = %s", (core.format_code("ADV", aid), aid))
    return await get_advance(ctx, aid)

async def adjust_advance(ctx: Ctx, advance_id: int, data) -> dict:
    """Use (part of) an advance against a posted invoice of the same client."""
    core.require_accounts(ctx)
    adv = await _advance_or_404(advance_id)
    if adv["status"] == "CANCELLED":
        raise HTTPException(status_code=400, detail="This advance is cancelled")
    amount = D(data.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Adjustment amount must be greater than zero")
    remaining = D(adv["amount"]) - await _adjusted(advance_id)
    if amount > remaining:
        raise HTTPException(status_code=400, detail=f"Only {F(remaining)} of this advance is left")
    inv = await _invoice_or_404(data.invoice_id)
    if inv["client_id"] != adv["client_id"]:
        raise HTTPException(status_code=400, detail=f"Invoice {inv['code']} belongs to a different client")
    if inv["status"] != "POSTED":
        raise HTTPException(status_code=400, detail=f"Invoice {inv['code']} is {inv['status']} — only posted invoices can be adjusted")
    out = await invoice_outstanding(inv)
    if amount > out:
        raise HTTPException(status_code=400, detail=f"Invoice {inv['code']} only has {F(out)} outstanding")
    await execute_query("INSERT INTO advance_adjustments (advance_id, invoice_id, amount, created_by, created_at) VALUES (%s, %s, %s, %s, %s)", (advance_id, data.invoice_id, amount, ctx.uid, core.now_iso()))
    await _refresh_advance_status(advance_id)
    return await get_advance(ctx, advance_id)

async def cancel_advance(ctx: Ctx, advance_id: int, reason: str) -> dict:
    core.require_accounts(ctx)
    adv = await _advance_or_404(advance_id)
    if adv["status"] == "CANCELLED":
        raise HTTPException(status_code=409, detail="This advance is already cancelled")
    if await _adjusted(advance_id) > 0:
        raise HTTPException(status_code=400, detail="This advance has been adjusted against invoices — cancel those invoices (or their adjustments) first")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for cancelling")
    await execute_query("UPDATE client_advances SET status = 'CANCELLED', cancelled_by = %s, cancelled_at = %s, cancel_reason = %s WHERE id = %s", (ctx.uid, core.now_iso(), reason.strip(), advance_id))
    return await get_advance(ctx, advance_id)


# ====================================================================== client ledger

async def client_ledger(ctx: Ctx, client_id: int) -> dict:
    """Invoices (debit), payments and advances (credit) for one client, with the running balance. Positive balance = the client owes us."""
    core.require_accounts_read(ctx)
    client = await core.client_or_404(client_id)
    entries = []
    for i in (await execute_query("SELECT * FROM invoices WHERE client_id = %s AND status IN ('POSTED', 'CANCELLED')", (client_id,), fetch_all=True) or []):
        entries.append({"date": i["invoice_date"] or (i["posted_at"] or "")[:10], "sort": i["posted_at"] or "", "type": "INVOICE", "ref": i["code"], "document_id": i["id"], "debit": F(i["net_amount"]), "credit": 0.0, "note": f"Period {i['period']}"})
        if i["status"] == "CANCELLED":
            entries.append({"date": (i["cancelled_at"] or "")[:10], "sort": i["cancelled_at"] or "", "type": "INVOICE_REVERSAL", "ref": i["code"], "document_id": i["id"], "debit": 0.0, "credit": F(i["net_amount"]), "note": i["cancel_reason"]})
    for p in (await execute_query("SELECT * FROM client_payments WHERE client_id = %s AND status IN ('POSTED', 'CANCELLED')", (client_id,), fetch_all=True) or []):
        entries.append({"date": p["payment_date"], "sort": p["posted_at"] or "", "type": "PAYMENT", "ref": p["code"], "document_id": p["id"], "debit": 0.0, "credit": F(p["amount"]), "note": p["reference"]})
        if p["status"] == "CANCELLED":
            entries.append({"date": (p["cancelled_at"] or "")[:10], "sort": p["cancelled_at"] or "", "type": "PAYMENT_REVERSAL", "ref": p["code"], "document_id": p["id"], "debit": F(p["amount"]), "credit": 0.0, "note": p["cancel_reason"]})
    for a in (await execute_query("SELECT * FROM client_advances WHERE client_id = %s", (client_id,), fetch_all=True) or []):
        entries.append({"date": a["advance_date"], "sort": a["created_at"] or "", "type": "ADVANCE", "ref": a["code"], "document_id": a["id"], "debit": 0.0, "credit": F(a["amount"]), "note": a["reference"]})
        if a["status"] == "CANCELLED":
            entries.append({"date": (a["cancelled_at"] or "")[:10], "sort": a["cancelled_at"] or "", "type": "ADVANCE_REVERSAL", "ref": a["code"], "document_id": a["id"], "debit": F(a["amount"]), "credit": 0.0, "note": a["cancel_reason"]})
    entries.sort(key=lambda e: (e["date"], e["sort"]))
    balance = D(0)
    for e in entries:
        balance += D(e["debit"]) - D(e["credit"])
        e["balance"] = F(balance)
        e.pop("sort")
    open_invoices = []
    for i in (await execute_query("SELECT i.*, k.code AS contract_code FROM invoices i JOIN contracts k ON k.id = i.contract_id WHERE i.client_id = %s AND i.status = 'POSTED' ORDER BY i.invoice_date, i.id", (client_id,), fetch_all=True) or []):
        out = await invoice_outstanding(i)
        if out > 0:
            age = (core.today() - date.fromisoformat(i["invoice_date"])).days if i["invoice_date"] else 0
            open_invoices.append({"invoice_id": i["id"], "code": i["code"], "contract_code": i["contract_code"], "invoice_date": i["invoice_date"], "net_amount": F(i["net_amount"]), "outstanding": F(out), "age_days": age, "overdue_60": age > core.OVERDUE_DAYS})
    unalloc_payments = D(0)
    for p in (await execute_query("SELECT * FROM client_payments WHERE client_id = %s AND status = 'POSTED'", (client_id,), fetch_all=True) or []):
        unalloc_payments += D(p["amount"]) - await _allocated(p["id"])
    adv_remaining = D(0)
    for a in (await execute_query("SELECT * FROM client_advances WHERE client_id = %s AND status != 'CANCELLED'", (client_id,), fetch_all=True) or []):
        adv_remaining += D(a["amount"]) - await _adjusted(a["id"])
    totals = {"invoiced": F(sum((D(e["debit"]) for e in entries if e["type"] == "INVOICE"), D(0)) - sum((D(e["credit"]) for e in entries if e["type"] == "INVOICE_REVERSAL"), D(0))),
              "payments": F(sum((D(e["credit"]) for e in entries if e["type"] == "PAYMENT"), D(0)) - sum((D(e["debit"]) for e in entries if e["type"] == "PAYMENT_REVERSAL"), D(0))),
              "advances": F(sum((D(e["credit"]) for e in entries if e["type"] == "ADVANCE"), D(0)) - sum((D(e["debit"]) for e in entries if e["type"] == "ADVANCE_REVERSAL"), D(0)))}
    return {"client": {"id": client["id"], "code": client["code"], "name": client["name"]}, "entries": entries, "balance": F(balance), "totals": totals, "open_invoices": open_invoices,
            "outstanding_invoices": F(sum((D(i["outstanding"]) for i in open_invoices), D(0))), "unallocated_payments": F(unalloc_payments), "advances_remaining": F(adv_remaining)}

async def ledger_summary(ctx: Ctx) -> list:
    core.require_accounts_read(ctx)
    rows = await execute_query("SELECT id FROM clients ORDER BY name", fetch_all=True)
    out = []
    for r in (rows or []):
        ledger = await client_ledger(ctx, r["id"])
        if ledger["entries"]:
            out.append({"client_id": r["id"], "client": ledger["client"]["name"], "code": ledger["client"]["code"], "balance": ledger["balance"], "outstanding_invoices": ledger["outstanding_invoices"],
                        "unallocated_payments": ledger["unallocated_payments"], "advances_remaining": ledger["advances_remaining"]})
    return out


# ====================================================================== KPIs

def _ratio_pct(num: int, den: int) -> Optional[float]:
    return round(num * 100 / den, 2) if den else None   # null (not 0) when there is nothing to divide by

async def kpis(ctx: Ctx) -> dict:
    """Receivables KPI for the Accounts side (the sales KPIs live in ``cm_crm.overview``). null, not 0, when there is nothing to measure."""
    core.require_any(ctx)
    out = {"receivables_overdue_60": None}
    if ctx.acct:
        cutoff = (core.today() - timedelta(days=core.OVERDUE_DAYS)).isoformat()
        rows = await execute_query("SELECT * FROM invoices WHERE status = 'POSTED'", fetch_all=True)
        if rows:
            amount, count = D(0), 0
            for i in rows:
                if i["invoice_date"] and i["invoice_date"] < cutoff:
                    o = await invoice_outstanding(i)
                    if o > 0:
                        amount += o; count += 1
            out["receivables_overdue_60"] = {"amount": F(amount), "invoices": count}
    return out
