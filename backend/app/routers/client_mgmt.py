"""Client Management (``/api/client-mgmt``): clients, leads, tenders, proposals, contracts and engagements, invoices, payments, advances,
the client ledger, the pipeline summary and KPIs. The no-login proposal reply link lives in ``public_proposals.py``.

Who can do what is decided in ``app.services.cm_core`` (Sales / Manager through the "sales" matrix row, Accounts through "accounts").
"""

from typing import Optional

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import Response

from app.core.config import CLIENT_MGMT_FILE_MAX_BYTES
from app.core.security import get_current_user
from app.schemas.client_mgmt import (
    ActivityIn, AdjustIn, AgreementIn, InvoiceEmailIn, SendDocumentsIn, AdvanceIn, AllocateIn, ClientIn, ClientUpdate, ContractStatusIn, ContractUpdate, EngagementIn, InvoiceIn, InvoiceUpdate, LeadImport, LeadIn, LeadUpdate,
    MonthEndIn, PaymentIn, PoIn, ProposalIn, ProposalUpdate, QualifyIn, ReasonIn, ReviewIn, SendIn, StageMove, TenderIn, TenderUpdate,
)
from app.services import cm_accounts as acct
from app.services import cm_contract_docs as docs
from app.services import cm_core as core
from app.services import cm_documents
from app.services import cm_reports as reports
from app.services import cm_webform
from app.services import cm_sales as sales


client_mgmt_router = APIRouter(prefix="/client-mgmt")


async def _ctx(request: Request) -> core.Ctx:
    ctx = await core.build_ctx(await get_current_user(request))
    core.require_any(ctx)
    return ctx

def _base(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@client_mgmt_router.get("/people")
async def people(request: Request):
    """Names for the owner picker (anyone with Client Management access)."""
    await _ctx(request)
    from app.db import execute_query
    rows = await execute_query("SELECT id, name, role FROM users ORDER BY name", fetch_all=True)
    return [dict(r) for r in (rows or [])]


# ---------- clients ----------

@client_mgmt_router.get("/clients")
async def list_clients(request: Request, q: str = "", active: Optional[bool] = None):
    return await sales.list_clients(await _ctx(request), q, active)

@client_mgmt_router.post("/clients")
async def create_client(data: ClientIn, request: Request):
    """409 with ``detail.duplicates`` for the same name or GSTIN (a shared GSTIN can be confirmed with ``confirm_duplicate``)."""
    return await sales.create_client(await _ctx(request), data)

@client_mgmt_router.get("/clients/{client_id}")
async def get_client(client_id: int, request: Request):
    return await sales.get_client(await _ctx(request), client_id)

@client_mgmt_router.put("/clients/{client_id}")
async def update_client(client_id: int, data: ClientUpdate, request: Request):
    return await sales.update_client(await _ctx(request), client_id, data)

@client_mgmt_router.delete("/clients/{client_id}")
async def delete_client(client_id: int, request: Request):
    await sales.delete_client(await _ctx(request), client_id)
    return {"message": "Client deleted"}

@client_mgmt_router.get("/clients/{client_id}/ledger")
async def client_ledger(client_id: int, request: Request):
    return await acct.client_ledger(await _ctx(request), client_id)


# ---------- leads ----------

@client_mgmt_router.get("/leads")
async def list_leads(request: Request, stage: str = "", owner_id: int = 0, q: str = "", overdue: bool = False):
    """The leads board data. ``overdue=true`` lists follow-ups due today or earlier."""
    return await sales.list_leads(await _ctx(request), stage=stage, owner_id=owner_id, q=q, overdue=overdue)

@client_mgmt_router.post("/leads")
async def create_lead(data: LeadIn, request: Request):
    """409 with ``detail.duplicates`` when the email or phone matches another lead; resend with ``confirm_duplicate`` to create it anyway."""
    return await sales.create_lead(await _ctx(request), data)

@client_mgmt_router.post("/leads/import")
async def import_leads(data: LeadImport, request: Request):
    return await sales.import_leads(await _ctx(request), data.rows, data.confirm_duplicate)

@client_mgmt_router.get("/leads/{lead_id}")
async def get_lead(lead_id: int, request: Request):
    return await sales.get_lead(await _ctx(request), lead_id)

@client_mgmt_router.put("/leads/{lead_id}")
async def update_lead(lead_id: int, data: LeadUpdate, request: Request):
    return await sales.update_lead(await _ctx(request), lead_id, data)

@client_mgmt_router.get("/leads/{lead_id}/activities")
async def list_activities(lead_id: int, request: Request):
    return await sales.list_activities(await _ctx(request), lead_id)

@client_mgmt_router.post("/leads/{lead_id}/activities")
async def add_activity(lead_id: int, data: ActivityIn, request: Request):
    return await sales.add_activity(await _ctx(request), lead_id, data)

@client_mgmt_router.post("/leads/{lead_id}/stage")
async def move_stage(lead_id: int, data: StageMove, request: Request):
    return await sales.move_stage(await _ctx(request), lead_id, data)

@client_mgmt_router.post("/leads/{lead_id}/qualify")
async def qualify(lead_id: int, data: QualifyIn, request: Request):
    """400 with ``detail.missing`` listing exactly what the lead still needs."""
    return await sales.qualify(await _ctx(request), lead_id, data)

@client_mgmt_router.post("/leads/{lead_id}/to-tender")
async def to_tender(lead_id: int, data: TenderIn, request: Request):
    return await sales.to_tender(await _ctx(request), lead_id, data)

@client_mgmt_router.post("/leads/{lead_id}/to-proposal")
async def to_proposal(lead_id: int, data: ProposalIn, request: Request):
    return await sales.to_proposal(await _ctx(request), lead_id, data)

@client_mgmt_router.get("/leads/{lead_id}/tenders")
async def list_tenders(lead_id: int, request: Request):
    return await sales.list_tenders(await _ctx(request), lead_id)


# ---------- tenders ----------

@client_mgmt_router.put("/tenders/{tender_id}")
async def update_tender(tender_id: int, data: TenderUpdate, request: Request):
    return await sales.update_tender(await _ctx(request), tender_id, data)


# ---------- proposals ----------

@client_mgmt_router.get("/proposals")
async def list_proposals(request: Request, lead_id: int = 0, client_id: int = 0, status: str = "", review_status: str = ""):
    return await sales.list_proposals(await _ctx(request), lead_id=lead_id, client_id=client_id, status=status, review_status=review_status)

@client_mgmt_router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: int, request: Request):
    return await sales.get_proposal(await _ctx(request), proposal_id)

@client_mgmt_router.put("/proposals/{proposal_id}")
async def update_proposal(proposal_id: int, data: ProposalUpdate, request: Request):
    """Edit the title, terms and (replacing the whole list) the items. Only while DRAFT, or after changes were asked for."""
    return await sales.update_proposal(await _ctx(request), proposal_id, data)

@client_mgmt_router.post("/proposals/{proposal_id}/send")
async def send_proposal(proposal_id: int, data: SendIn, request: Request):
    """Emails the PDF with the public reply link. Below-cost lines need ``override_reason`` (managers only)."""
    return await sales.send_proposal(await _ctx(request), proposal_id, data, _base(request))

@client_mgmt_router.post("/proposals/{proposal_id}/email")
async def email_proposal(proposal_id: int, data: SendIn, request: Request):
    return await sales.email_proposal_again(await _ctx(request), proposal_id, data, _base(request))

@client_mgmt_router.post("/proposals/{proposal_id}/review")
async def review_proposal(proposal_id: int, data: ReviewIn, request: Request):
    return await sales.review_proposal(await _ctx(request), proposal_id, data)

@client_mgmt_router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: int, data: ReasonIn, request: Request):
    return await sales.reject_proposal(await _ctx(request), proposal_id, data.reason)

@client_mgmt_router.post("/proposals/{proposal_id}/book-po")
async def book_po(proposal_id: int, data: PoIn, request: Request):
    """PO won: needs a SENT proposal with an APPROVED review. Creates the contract (DRAFT) and sets proposal ACCEPTED, tender WON and lead WON."""
    return await sales.book_po(await _ctx(request), proposal_id, data)

@client_mgmt_router.get("/proposals/{proposal_id}/pdf")
async def proposal_pdf(proposal_id: int, request: Request):
    buf = await sales.proposal_pdf(await _ctx(request), proposal_id)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="proposal-{proposal_id}.pdf"'})

@client_mgmt_router.post("/proposals/{proposal_id}/files")
async def upload_file(proposal_id: int, request: Request, file: UploadFile = File(...)):
    data = await file.read(CLIENT_MGMT_FILE_MAX_BYTES + 1)
    return await sales.upload_file(await _ctx(request), proposal_id, file.filename or "file", data, CLIENT_MGMT_FILE_MAX_BYTES)

@client_mgmt_router.get("/proposals/{proposal_id}/files/{file_id}")
async def download_file(proposal_id: int, file_id: int, request: Request):
    f = await sales.get_file(await _ctx(request), proposal_id, file_id)
    return Response(f["data"], media_type=f["content_type"], headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"', "Cache-Control": "private, no-store"})

@client_mgmt_router.delete("/proposals/{proposal_id}/files/{file_id}")
async def delete_file(proposal_id: int, file_id: int, request: Request):
    await sales.delete_file(await _ctx(request), proposal_id, file_id)
    return {"message": "File removed"}


# ---------- contracts & engagements ----------

@client_mgmt_router.get("/contracts")
async def list_contracts(request: Request, client_id: int = 0, status: str = ""):
    return await sales.list_contracts(await _ctx(request), client_id=client_id, status=status)

@client_mgmt_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: int, request: Request):
    return await sales.get_contract(await _ctx(request), contract_id)

@client_mgmt_router.put("/contracts/{contract_id}")
async def update_contract(contract_id: int, data: ContractUpdate, request: Request):
    return await sales.update_contract(await _ctx(request), contract_id, data)

@client_mgmt_router.post("/contracts/{contract_id}/engagement")
async def create_engagement(contract_id: int, request: Request, data: EngagementIn = EngagementIn()):
    """Creates the engagement (a project on the project board) in one click, or links ``project_id``. The contract becomes ACTIVE."""
    return await sales.create_engagement(await _ctx(request), contract_id, data)

@client_mgmt_router.post("/contracts/{contract_id}/status")
async def set_contract_status(contract_id: int, data: ContractStatusIn, request: Request):
    return await sales.set_contract_status(await _ctx(request), contract_id, data)

@client_mgmt_router.put("/contracts/{contract_id}/agreement")
async def update_agreement(contract_id: int, data: AgreementIn, request: Request):
    """Scope of work, agreement wording, and the agreement status (NONE → DRAFT → SENT → SIGNED)."""
    return await docs.update_agreement(await _ctx(request), contract_id, data)

@client_mgmt_router.get("/contracts/{contract_id}/agreement-pdf")
async def agreement_pdf(contract_id: int, request: Request):
    buf = await docs.agreement_pdf(await _ctx(request), contract_id)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="agreement-{contract_id}.pdf"'})

@client_mgmt_router.get("/contracts/{contract_id}/scope-pdf")
async def scope_pdf(contract_id: int, request: Request):
    buf = await docs.scope_pdf(await _ctx(request), contract_id)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="scope-of-work-{contract_id}.pdf"'})

@client_mgmt_router.post("/contracts/{contract_id}/send-documents")
async def send_contract_documents(contract_id: int, data: SendDocumentsIn, request: Request):
    """Emails the chosen documents (commercial, scope, agreement) to the client. Only when called: nothing is sent automatically."""
    return await cm_documents.send_contract_documents(await _ctx(request), contract_id, data)

@client_mgmt_router.get("/contracts/{contract_id}/files")
async def list_contract_files(contract_id: int, request: Request):
    return await docs.list_files(await _ctx(request), contract_id)

@client_mgmt_router.post("/contracts/{contract_id}/files")
async def upload_contract_file(contract_id: int, request: Request, kind: str = "PO", file: UploadFile = File(...)):
    """``kind``: PO (the client's purchase order), AGREEMENT, SIGNED_AGREEMENT or OTHER."""
    data = await file.read(CLIENT_MGMT_FILE_MAX_BYTES + 1)
    return await docs.upload_file(await _ctx(request), contract_id, kind, file.filename or "file", data, CLIENT_MGMT_FILE_MAX_BYTES)

@client_mgmt_router.get("/contracts/{contract_id}/files/{file_id}")
async def download_contract_file(contract_id: int, file_id: int, request: Request):
    f = await docs.get_file(await _ctx(request), contract_id, file_id)
    return Response(f["data"], media_type=f["content_type"], headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"', "Cache-Control": "private, no-store"})

@client_mgmt_router.delete("/contracts/{contract_id}/files/{file_id}")
async def delete_contract_file(contract_id: int, file_id: int, request: Request):
    await docs.delete_file(await _ctx(request), contract_id, file_id)
    return {"message": "File removed"}

@client_mgmt_router.get("/contracts/{contract_id}/invoice-suggestion")
async def invoice_suggestion(contract_id: int, period: str, request: Request):
    return await acct.invoice_suggestion(await _ctx(request), contract_id, period)


# ---------- invoices ----------

@client_mgmt_router.get("/invoices")
async def list_invoices(request: Request, client_id: int = 0, contract_id: int = 0, status: str = "", period: str = ""):
    return await acct.list_invoices(await _ctx(request), client_id=client_id, contract_id=contract_id, status=status, period=period)

@client_mgmt_router.post("/invoices")
async def create_invoice(data: InvoiceIn, request: Request):
    return await acct.create_invoice(await _ctx(request), data)

@client_mgmt_router.post("/invoices/month-end")
async def month_end(request: Request, data: MonthEndIn = MonthEndIn()):
    """Draft one invoice per eligible active contract for the month (the same job that runs on the last day of each month). Nothing is posted."""
    return await acct.run_month_end(await _ctx(request), data.month)

@client_mgmt_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: int, request: Request):
    return await acct.get_invoice(await _ctx(request), invoice_id)

@client_mgmt_router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: int, data: InvoiceUpdate, request: Request):
    return await acct.update_invoice(await _ctx(request), invoice_id, data)

@client_mgmt_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: int, request: Request):
    await acct.delete_invoice(await _ctx(request), invoice_id)
    return {"message": "Draft invoice deleted"}

@client_mgmt_router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: int, request: Request):
    buf = await cm_documents.invoice_pdf(await _ctx(request), invoice_id)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="invoice-{invoice_id}.pdf"'})

@client_mgmt_router.post("/invoices/{invoice_id}/email")
async def email_invoice(invoice_id: int, data: InvoiceEmailIn, request: Request):
    return await cm_documents.email_invoice(await _ctx(request), invoice_id, data)

@client_mgmt_router.post("/invoices/{invoice_id}/post")
async def post_invoice(invoice_id: int, request: Request):
    return await acct.post_invoice(await _ctx(request), invoice_id)

@client_mgmt_router.post("/invoices/{invoice_id}/cancel")
async def cancel_invoice(invoice_id: int, data: ReasonIn, request: Request):
    """Reverse a posted invoice with a reason; releases payment allocations and advance adjustments made against it."""
    return await acct.cancel_invoice(await _ctx(request), invoice_id, data.reason)


# ---------- payments ----------

@client_mgmt_router.get("/payments")
async def list_payments(request: Request, client_id: int = 0, status: str = ""):
    return await acct.list_payments(await _ctx(request), client_id, status)

@client_mgmt_router.post("/payments")
async def create_payment(data: PaymentIn, request: Request):
    return await acct.create_payment(await _ctx(request), data)

@client_mgmt_router.get("/payments/{payment_id}")
async def get_payment(payment_id: int, request: Request):
    return await acct.get_payment(await _ctx(request), payment_id)

@client_mgmt_router.post("/payments/{payment_id}/post")
async def post_payment(payment_id: int, request: Request, data: Optional[AllocateIn] = None):
    """Post the payment; optionally allocate it to invoices in the same step."""
    return await acct.post_payment(await _ctx(request), payment_id, data.allocations if data else None)

@client_mgmt_router.post("/payments/{payment_id}/allocate")
async def allocate_payment(payment_id: int, data: AllocateIn, request: Request):
    return await acct.allocate_payment(await _ctx(request), payment_id, data.allocations)

@client_mgmt_router.post("/payments/{payment_id}/cancel")
async def cancel_payment(payment_id: int, data: ReasonIn, request: Request):
    return await acct.cancel_payment(await _ctx(request), payment_id, data.reason)

@client_mgmt_router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: int, request: Request):
    await acct.delete_payment(await _ctx(request), payment_id)
    return {"message": "Draft payment deleted"}


# ---------- advances ----------

@client_mgmt_router.get("/advances")
async def list_advances(request: Request, client_id: int = 0, status: str = ""):
    return await acct.list_advances(await _ctx(request), client_id, status)

@client_mgmt_router.post("/advances")
async def create_advance(data: AdvanceIn, request: Request):
    return await acct.create_advance(await _ctx(request), data)

@client_mgmt_router.get("/advances/{advance_id}")
async def get_advance(advance_id: int, request: Request):
    return await acct.get_advance(await _ctx(request), advance_id)

@client_mgmt_router.post("/advances/{advance_id}/adjust")
async def adjust_advance(advance_id: int, data: AdjustIn, request: Request):
    return await acct.adjust_advance(await _ctx(request), advance_id, data)

@client_mgmt_router.post("/advances/{advance_id}/cancel")
async def cancel_advance(advance_id: int, data: ReasonIn, request: Request):
    return await acct.cancel_advance(await _ctx(request), advance_id, data.reason)


# ---------- ledger, pipeline, KPIs ----------

@client_mgmt_router.get("/ledger")
async def ledger_summary(request: Request):
    """Balance per client (clients with any ledger activity)."""
    return await acct.ledger_summary(await _ctx(request))

@client_mgmt_router.get("/pipeline")
async def pipeline(request: Request):
    """Sales Flow summary: leads per stage (count and value), proposals, contracts, overdue follow-ups and the step-bar counts."""
    return await sales.pipeline_summary(await _ctx(request))

@client_mgmt_router.get("/kpis")
async def kpis(request: Request):
    return await acct.kpis(await _ctx(request))


# ---------- dashboard, alerts and exports ----------

@client_mgmt_router.get("/dashboard")
async def dashboard(request: Request):
    """KPIs, alerts, receivables ageing (Accounts) and the 6-month invoiced / collected trend (Accounts), within the caller's access."""
    return await reports.dashboard(await _ctx(request))

@client_mgmt_router.get("/alerts")
async def alerts(request: Request):
    return await reports.alerts(await _ctx(request))

@client_mgmt_router.get("/receivables")
async def receivables(request: Request):
    return await reports.receivables_aging(await _ctx(request))

@client_mgmt_router.get("/reports/{name}.csv")
async def export_report(name: str, request: Request):
    filename, text = await reports.export_csv(await _ctx(request), name)
    return Response(text.encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"})


# ---------- web form link ----------

@client_mgmt_router.get("/web-form")
async def web_form(request: Request):
    """The public lead-capture form: its link and an embed snippet. Submissions arrive as NEW leads (source Website, unassigned) for a manager to assign."""
    ctx = await _ctx(request)
    core.require_sales_read(ctx)
    return {**cm_webform.form_link(sales.public_base(_base(request))), "submissions_become": "New leads (source Website, no owner until a manager assigns one)"}
