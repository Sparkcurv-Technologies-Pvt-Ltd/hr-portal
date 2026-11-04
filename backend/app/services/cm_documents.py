"""Client documents as PDFs and (only when someone clicks Send) emailed to the client: invoice, scope of work, commercial proposal, agreement.

Nothing here is automatic: every email is an explicit action by a manager (contract documents) or Accounts (invoices)."""

import asyncio

from fastapi import HTTPException

from app.core.email import _cm_documents_email_html, _send_email_with_attachments
from app.db import execute_query
from app.services import cm_accounts as acct
from app.services import cm_contract_docs as docs
from app.services import cm_core as core
from app.services import cm_sales as sales
from app.services.cm_core import Ctx
from app.services.proposal_pdf import generate_invoice_pdf

SENDER = "Sparkcurv"
LABELS = {"commercial": "Commercial Proposal", "scope": "Scope of Work", "agreement": "Service Agreement"}


def _send_with_attachments(to: str, subject: str, html_body: str, attachments: list, category: str = "sales") -> None:   # the tests replace this
    _send_email_with_attachments(to, subject, html_body, attachments, category)


def _queue(to: str, subject: str, html_body: str, attachments: list) -> None:
    asyncio.get_event_loop().run_in_executor(None, _send_with_attachments, to, subject, html_body, attachments)


def _recipient(to, client: dict) -> str:
    to = (to or client.get("email") or "").strip()
    if not core.valid_email(to):
        raise HTTPException(status_code=400, detail="Enter a valid email address to send to (the client has none on file)" if not to else "That email address doesn't look right")
    return to


async def invoice_pdf(ctx: Ctx, invoice_id: int):
    core.require_accounts_read(ctx)
    inv = await acct._invoice_or_404(invoice_id)
    client = await core.client_or_404(inv["client_id"])
    contract = await execute_query("SELECT * FROM contracts WHERE id = %s", (inv["contract_id"],), fetch_one=True)
    return generate_invoice_pdf(acct.invoice_out(inv), dict(client), dict(contract))


async def email_invoice(ctx: Ctx, invoice_id: int, data) -> dict:
    """Email a POSTED invoice (PDF attached, optionally with the contract's scope of work)."""
    core.require_accounts(ctx)
    inv = await acct._invoice_or_404(invoice_id)
    if inv["status"] != "POSTED":
        raise HTTPException(status_code=400, detail="Only a posted invoice can be emailed — post it first")
    client = await core.client_or_404(inv["client_id"])
    to = _recipient(data.to, client)
    attachments = [(f"{inv['code']}.pdf", (await invoice_pdf(ctx, invoice_id)).getvalue())]
    names = [("Tax Invoice", f"{inv['code']} · period {inv['period']}")]
    if data.include_scope:
        k = await execute_query("SELECT * FROM contracts WHERE id = %s", (inv["contract_id"],), fetch_one=True)
        attachments.append((f"{k['code']}-scope-of-work.pdf", (await docs.scope_pdf(ctx, inv["contract_id"])).getvalue()))
        names.append(("Scope of Work", k["code"]))
    html_body = _cm_documents_email_html(client["name"], f"Invoice {inv['code']}", names, (data.message or "").strip(), SENDER)
    _queue(to, f"Invoice {inv['code']} from Sparkcurv", html_body, attachments)
    now = core.now_iso()
    await execute_query("UPDATE invoices SET emailed_at = %s, emailed_to = %s WHERE id = %s", (now, to, invoice_id))
    return {"message": f"Invoice {inv['code']} emailed to {to}", "emailed_to": to, "emailed_at": now}


async def send_contract_documents(ctx: Ctx, contract_id: int, data) -> dict:
    """Email the chosen contract documents (commercial proposal, scope of work, agreement) to the client. Managers only."""
    core.require_manager(ctx)
    k = await sales._contract_or_404(ctx, contract_id)
    wanted = list(dict.fromkeys(data.documents or []))
    if not wanted or any(w not in LABELS for w in wanted):
        raise HTTPException(status_code=400, detail=f"Choose at least one document: {', '.join(LABELS)}")
    client = await core.client_or_404(k["client_id"])
    to = _recipient(data.to, client)
    attachments, names = [], []
    for w in wanted:
        if w == "commercial":
            if not k["proposal_id"]:
                raise HTTPException(status_code=400, detail="This contract has no commercial proposal on file")
            p = await sales._proposal_or_404(ctx, k["proposal_id"])
            attachments.append((f"{p['code']}-commercial-proposal.pdf", (await sales._build_pdf(p)).getvalue())); names.append((LABELS[w], p["code"]))
        elif w == "scope":
            if not (k.get("scope_of_work") or "").strip():
                raise HTTPException(status_code=400, detail="Write the scope of work on the contract first")
            attachments.append((f"{k['code']}-scope-of-work.pdf", (await docs.scope_pdf(ctx, contract_id)).getvalue())); names.append((LABELS[w], k["code"]))
        else:
            attachments.append((f"{k['code']}-agreement.pdf", (await docs.agreement_pdf(ctx, contract_id)).getvalue())); names.append((LABELS[w], k["code"]))
    html_body = _cm_documents_email_html(client["name"], "Documents from Sparkcurv", names, (data.message or "").strip(), SENDER)
    _queue(to, f"{' & '.join(LABELS[w] for w in wanted)} — {k['contract_no'] or k['code']}", html_body, attachments)
    await sales._note(k, f"Emailed to {to}: {', '.join(LABELS[w] for w in wanted)}", ctx, "Email")
    return {"message": f"Sent to {to}", "sent_to": to, "documents": wanted}
