"""Client Management reporting: the KPI dashboard (KPIs + alerts + receivables ageing + monthly trend) and CSV exports.

Everything follows the caller's access: Sales see their own leads / proposals / contracts, Accounts see the money side, managers and admins see both.
"""

import csv
import io
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException

from app.db import execute_query
from app.services import cm_accounts as acct
from app.services import cm_core as core
from app.services.cm_core import D, F, Ctx
from app.services import cm_crm

BUCKETS = (("0-30", 0, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("90+", 91, 10 ** 6))
REVIEW_STALE_DAYS = 3
EXPIRY_WARN_DAYS = 7
CONTRACT_END_WARN_DAYS = 30
DRAFT_CONTRACT_DAYS = 7
STALE_OPP_DAYS = 14
from datetime import timedelta


def _age(iso: str) -> int:
    return (core.today() - date.fromisoformat(iso[:10])).days if iso else 0


async def receivables_aging(ctx: Ctx) -> dict:
    """Outstanding on posted invoices, bucketed by age from the invoice date, in total and per client."""
    core.require_accounts_read(ctx)
    totals = {name: D(0) for name, _, _ in BUCKETS}
    per_client, invoices = {}, []
    for i in (await execute_query("SELECT i.*, c.name AS client_name, k.code AS contract_code FROM invoices i JOIN clients c ON c.id = i.client_id JOIN contracts k ON k.id = i.contract_id WHERE i.status = 'POSTED' ORDER BY i.invoice_date, i.id", fetch_all=True) or []):
        out = await acct.invoice_outstanding(i)
        if out <= 0:
            continue
        age = _age(i["invoice_date"])
        bucket = next(n for n, lo, hi in BUCKETS if lo <= max(age, 0) <= hi)
        totals[bucket] += out
        row = per_client.setdefault(i["client_id"], {"client_id": i["client_id"], "client": i["client_name"], **{n: D(0) for n, _, _ in BUCKETS}, "total": D(0)})
        row[bucket] += out; row["total"] += out
        invoices.append({"invoice_id": i["id"], "code": i["code"], "client_id": i["client_id"], "client": i["client_name"], "contract_code": i["contract_code"], "invoice_date": i["invoice_date"],
                         "outstanding": F(out), "age_days": age, "bucket": bucket})
    clients = [{k: (F(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in sorted(per_client.values(), key=lambda r: r["total"], reverse=True)]
    return {"buckets": [{"bucket": n, "amount": F(totals[n])} for n, _, _ in BUCKETS], "total": F(sum(totals.values(), D(0))), "clients": clients, "invoices": invoices}


async def monthly_trend(ctx: Ctx, months: int = 6) -> list:
    """Posted invoices (net) and posted payments per month for the last ``months`` months (cancelled documents excluded)."""
    core.require_accounts_read(ctx)
    t = core.today()
    keys = []
    y, m = t.year, t.month
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    keys.reverse()
    inv = await execute_query("SELECT SUBSTRING(invoice_date, 1, 7) AS ym, COALESCE(SUM(net_amount), 0) AS s FROM invoices WHERE status = 'POSTED' AND invoice_date >= %s GROUP BY ym", (keys[0] + "-01",), fetch_all=True)
    pay = await execute_query("SELECT SUBSTRING(payment_date, 1, 7) AS ym, COALESCE(SUM(amount), 0) AS s FROM client_payments WHERE status = 'POSTED' AND payment_date >= %s GROUP BY ym", (keys[0] + "-01",), fetch_all=True)
    i_map, p_map = {r["ym"]: r["s"] for r in (inv or [])}, {r["ym"]: r["s"] for r in (pay or [])}
    return [{"month": k, "invoiced": F(i_map.get(k, 0)), "collected": F(p_map.get(k, 0))} for k in keys]


def _alert(kind: str, severity: str, message: str, **ref) -> dict:
    return {"kind": kind, "severity": severity, "message": message, **ref}


async def alerts(ctx: Ctx) -> list:
    """Things that need someone to act, most urgent first. Each alert says what it is and links to the record (``lead_id`` / ``proposal_id`` / ``contract_id`` / ``invoice_id``)."""
    core.require_any(ctx)
    out, today = [], core.today()
    if ctx.sales:
        fsql, fargs = cm_crm.scope(ctx, "f")
        for r in (await execute_query(f"SELECT f.id, f.company_name, s.step_no, s.step_date FROM followup_steps s JOIN followups f ON f.id = s.followup_id WHERE {fsql} AND s.step_date <= %s "
                                      "AND (s.outcome IS NULL OR s.outcome IN ('Pending', 'Rescheduled')) ORDER BY s.step_date LIMIT 100", (*fargs, today.isoformat()), fetch_all=True) or []):
            late = (today - date.fromisoformat(r["step_date"])).days
            out.append(_alert("FOLLOWUP", "high" if late > 0 else "medium", f"{core.CADENCE[r['step_no'] - 1]} with {r['company_name']}" + (f" — {late} day(s) overdue" if late > 0 else " — due today"), followup_id=r["id"]))
        osql, oargs = cm_crm.scope(ctx, "o")
        stale = (today - timedelta(days=STALE_OPP_DAYS)).isoformat()
        for r in (await execute_query(f"SELECT o.id, o.code, o.opp_name, o.last_activity_date, o.created_date FROM opportunities o WHERE {osql} AND o.stage IN ('Discovery', 'Demo Completed', 'Pricing/POC Discussion', 'Qualified') "
                                      "AND COALESCE(o.last_activity_date, o.created_date, '9999') < %s ORDER BY COALESCE(o.last_activity_date, o.created_date) LIMIT 30", (*oargs, stale), fetch_all=True) or []):
            since = r["last_activity_date"] or r["created_date"]
            out.append(_alert("OPPORTUNITY_STALE", "low", f"{r['opp_name']} has had no activity for {_age(since)} days", opportunity_id=r["id"]))
        pscope, pargs = ("", []) if ctx.sees_all_sales else (" AND p.owner_id = %s", [ctx.uid])
        for r in (await execute_query(f"SELECT p.id, p.code, p.title, p.status, p.review_status, p.valid_until, p.sent_at, p.updated_at FROM proposals p WHERE p.status IN ('DRAFT','SENT'){pscope}", tuple(pargs), fetch_all=True) or []):
            if r["status"] == "SENT" and r["review_status"] == "PENDING" and ctx.sales == "mgr" and _age(r["sent_at"] or "") >= REVIEW_STALE_DAYS:
                out.append(_alert("REVIEW_WAITING", "medium", f"{r['code']} has waited {_age(r['sent_at'])} days for review", proposal_id=r["id"]))
            if r["status"] == "SENT" and r["review_status"] == "APPROVED" and ctx.sales == "mgr":
                out.append(_alert("PO_PENDING", "low", f"{r['code']} is approved — book the PO when it arrives", proposal_id=r["id"]))
            if r["status"] == "SENT" and r["review_status"] == "CHANGES_ASKED":
                out.append(_alert("CHANGES_ASKED", "medium", f"{r['code']} needs changes before it can go out again", proposal_id=r["id"]))
            if r["valid_until"] and r["status"] in ("DRAFT", "SENT"):
                days = (date.fromisoformat(r["valid_until"]) - today).days
                if days < 0:
                    out.append(_alert("PROPOSAL_EXPIRED", "high", f"{r['code']} expired {-days} day(s) ago", proposal_id=r["id"]))
                elif days <= EXPIRY_WARN_DAYS:
                    out.append(_alert("PROPOSAL_EXPIRING", "medium", f"{r['code']} expires in {days} day(s)", proposal_id=r["id"]))
    if ctx.sales or ctx.acct:
        where, args = "", []
        if ctx.sales == "sales" and not ctx.acct:
            where, args = " AND (k.proposal_id IN (SELECT id FROM proposals WHERE owner_id = %s) OR k.opportunity_id IN (SELECT id FROM opportunities WHERE owner_id = %s))", [ctx.uid, ctx.uid]
        for k in (await execute_query(f"SELECT k.id, k.code, k.status, k.end_date, k.created_at, k.agreement_status, (SELECT COUNT(*) FROM contract_files f WHERE f.contract_id = k.id AND f.kind = 'PO') AS po_files FROM contracts k WHERE k.status IN ('DRAFT','ACTIVE'){where}", tuple(args), fetch_all=True) or []):
            if k["status"] == "DRAFT" and _age(k["created_at"] or "") >= DRAFT_CONTRACT_DAYS:
                out.append(_alert("CONTRACT_NOT_CONVERTED", "medium", f"{k['code']} has been a draft for {_age(k['created_at'])} days — convert it to an engagement", contract_id=k["id"]))
            if not k["po_files"]:
                out.append(_alert("PO_DOCUMENT_MISSING", "low", f"{k['code']}: the client's PO document isn't uploaded", contract_id=k["id"]))
            if k["agreement_status"] != "SIGNED":
                out.append(_alert("AGREEMENT_UNSIGNED", "medium" if k["status"] == "ACTIVE" else "low", f"{k['code']}: agreement is {k['agreement_status'].lower() if k['agreement_status'] != 'NONE' else 'not started'}", contract_id=k["id"]))
            if k["status"] == "ACTIVE" and k["end_date"]:
                days = (date.fromisoformat(k["end_date"]) - today).days
                if 0 <= days <= CONTRACT_END_WARN_DAYS:
                    out.append(_alert("CONTRACT_ENDING", "medium", f"{k['code']} ends in {days} day(s)", contract_id=k["id"]))
                elif days < 0:
                    out.append(_alert("CONTRACT_OVERDUE_END", "high", f"{k['code']} passed its end date {-days} day(s) ago — close it out", contract_id=k["id"]))
    if ctx.acct:
        for i in (await receivables_aging(ctx))["invoices"]:
            if i["age_days"] > core.OVERDUE_DAYS:
                out.append(_alert("RECEIVABLE_OVERDUE", "high", f"{i['code']} ({i['client']}) — {i['outstanding']:,.2f} outstanding for {i['age_days']} days", invoice_id=i["invoice_id"]))
        n = await execute_query("SELECT COUNT(*) AS n FROM invoices WHERE status = 'DRAFT'", fetch_one=True)
        if n["n"]:
            out.append(_alert("DRAFT_INVOICES", "low", f"{n['n']} draft invoice(s) waiting to be posted"))
        n = await execute_query("SELECT COUNT(*) AS n FROM client_payments WHERE status = 'DRAFT'", fetch_one=True)
        if n["n"]:
            out.append(_alert("DRAFT_PAYMENTS", "low", f"{n['n']} draft payment(s) waiting to be posted"))
    order = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda a: order[a["severity"]])
    return out


async def dashboard(ctx: Ctx, owner_id: int = 0) -> dict:
    """The sheet's overview (``crm``; null without Sales access) plus alerts and, for Accounts, receivables ageing and the 6-month trend."""
    core.require_any(ctx)
    out = {"crm": await cm_crm.overview(ctx, owner_id) if ctx.sales else None, "kpis": await acct.kpis(ctx), "alerts": await alerts(ctx), "aging": None, "trend": None}
    if ctx.acct:
        out["aging"], out["trend"] = await receivables_aging(ctx), await monthly_trend(ctx)
    return out


# ---------------------------------------------------------------- CSV exports

EXPORTS = {
    "leads": ("sales", "Leads"), "accounts": ("any", "Accounts"), "opportunities": ("sales", "Opportunities"), "followups": ("sales", "Follow-ups"), "activity": ("sales", "Activity log"),
    "proposals": ("sales", "Proposals"), "contracts": ("any", "Contracts"),
    "invoices": ("acct", "Invoices"), "payments": ("acct", "Payments"), "receivables": ("acct", "Receivables"), "ledger": ("acct", "Client balances"),
}


def _csv(header: list, rows: list) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        # spreadsheet formula injection: a cell that starts with = + - @ is typed by users, so prefix it with an apostrophe
        w.writerow([("'" + c) if isinstance(c, str) and c[:1] in ("=", "+", "-", "@") else ("" if c is None else c) for c in r])
    return buf.getvalue()


async def export_csv(ctx: Ctx, name: str) -> tuple:
    """(filename, csv text). The CRM exports use the sheet's own column headings, so a file exported here can be imported again. Same access checks as the lists the data comes from."""
    from app.services import cm_sales as sales
    if name not in EXPORTS:
        raise HTTPException(status_code=404, detail="Unknown report")
    stamp = core.today().isoformat()
    if name == "leads":
        data = await cm_crm.list_leads(ctx)
        return f"leads-{stamp}.csv", _csv(["Lead ID", "Company Name", "Contact Person", "Phone", "Email", "Location", "Lead Source", "Lead Status", "Date Added", "BDR Name", "Converted to Opportunity?", "Interested In / Notes", "Next Action"],
                                          [[d["code"], d["company_name"], d["contact_person"], d["phone"], d["email"], d["location"], d["source"], d["status"], d["date_added"], d["bdr"], "Yes" if d["converted"] else "No", d["interested_in"], d["next_action"]] for d in data])
    if name == "accounts":
        core.require_any(ctx)
        data = await sales.list_clients(ctx)
        return f"accounts-{stamp}.csv", _csv(["Account ID", "Company Name", "Industry", "Location", "Website", "Primary Contact", "Phone", "Email", "Account Type", "Account Owner", "Created Date", "Notes"],
                                             [[d["code"], d["name"], d["industry"], d["location"], d["website"], d["contact_person"], d["phone"], d["email"], d["account_type"], d["owner_name"], (d["created_at"] or "")[:10], d["notes"]] for d in data])
    if name == "opportunities":
        data = await cm_crm.list_opportunities(ctx)
        return f"opportunities-{stamp}.csv", _csv(["Opportunity ID", "Company Name", "Opp Name", "Contact Person", "Stage", "Deal Value (INR)", "Probability %", "Weighted Value (INR)", "Expected Close Date", "Lead Source", "BDR Name", "Created Date",
                                                   "Last Activity Date", "Next Action", "Notes"],
                                                  [[d["code"], d["account_name"], d["opp_name"], d["contact_person"], d["stage"], d["deal_value"], d["probability"], d["weighted_value"], d["expected_close_date"], d["lead_source"], d["bdr"],
                                                    d["created_date"], d["last_activity_date"], d["next_action"], d["notes"]] for d in data])
    if name == "followups":
        data = await cm_crm.list_followups(ctx)
        head = ["Follow-up ID", "Company Name", "Contact Person", "BDR Name", "Opportunity Stage (ref)"] + [h for label in core.CADENCE for h in (f"{label} Date", f"{label} Outcome")] + ["Current Step", "Notes"]
        return f"followups-{stamp}.csv", _csv(head, [[d["code"], d["company_name"], d["contact_person"], d["bdr"], d["opportunity_stage"]] + [v for st in d["steps"] for v in (st["date"], st["outcome"])] + [d["current_step"], d["notes"]] for d in data])
    if name == "activity":
        data = await cm_crm.list_activities(ctx, limit=10000)
        return f"activity-log-{stamp}.csv", _csv(["Log ID", "Date", "BDR Name", "Company Name", "Activity Type", "Outcome", "Notes"], [[d["code"], d["log_date"], d["bdr"], d["company_name"], d["activity_type"], d["outcome"], d["notes"]] for d in data])
    if name == "proposals":
        core.require_sales_read(ctx)
        data = await sales.list_proposals(ctx)
        return f"proposals-{stamp}.csv", _csv(["Code", "Title", "Client", "Opportunity", "Status", "Review", "Total", "Valid until", "Sent to", "Sent at", "Client response", "Owner"],
                                              [[d["code"], d["title"], d["client_name"], d["opportunity_name"], d["status"], d["review_status"], d["total_amount"], d["valid_until"], d["sent_to"], d["sent_at"], d["client_response"], d["owner_name"]] for d in data])
    if name == "contracts":
        data = await sales.list_contracts(ctx)
        return f"contracts-{stamp}.csv", _csv(["Code", "Contract no", "Client", "PO reference", "PO date", "Value", "Start", "End", "Status", "Agreement", "Signed on", "Engagement"],
                                              [[d["code"], d["contract_no"], d["client_name"], d["po_reference"], d["po_date"], d["contract_value"], d["start_date"], d["end_date"], d["status"], d["agreement_status"], d["agreement_signed_on"], d["engagement_name"]] for d in data])
    if name == "invoices":
        data = await acct.list_invoices(ctx)
        return f"invoices-{stamp}.csv", _csv(["Code", "Client", "Contract", "Period", "Date", "Gross", "Tax", "TDS", "Retention", "Net", "Outstanding", "Status", "Generated by"],
                                             [[d["code"], d["client_name"], d["contract_code"], d["period"], d["invoice_date"], d["gross_amount"], d["tax_amount"], d["tds_amount"], d["retention_amount"], d["net_amount"], d.get("outstanding"), d["status"], d["generated_by"]] for d in data])
    if name == "payments":
        data = await acct.list_payments(ctx)
        return f"payments-{stamp}.csv", _csv(["Code", "Client", "Date", "Reference", "Amount", "Allocated", "Unallocated", "Status"],
                                             [[d["code"], d["client_name"], d["payment_date"], d["reference"], d["amount"], d.get("allocated"), d.get("unallocated"), d["status"]] for d in data])
    if name == "receivables":
        data = (await receivables_aging(ctx))["invoices"]
        return f"receivables-{stamp}.csv", _csv(["Invoice", "Client", "Contract", "Invoice date", "Outstanding", "Age (days)", "Bucket"], [[d["code"], d["client"], d["contract_code"], d["invoice_date"], d["outstanding"], d["age_days"], d["bucket"]] for d in data])
    data = await acct.ledger_summary(ctx)
    return f"client-balances-{stamp}.csv", _csv(["Client code", "Client", "Balance (owed to us)", "Open invoices", "Unallocated payments", "Advances left"],
                                                [[d["code"], d["client"], d["balance"], d["outstanding_invoices"], d["unallocated_payments"], d["advances_remaining"]] for d in data])
