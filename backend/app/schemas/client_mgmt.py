"""Request bodies for Client Management (leads → proposals → contracts → invoices → payments)."""

from typing import List, Optional

from pydantic import BaseModel


class ClientIn(BaseModel):
    name: str
    gstin: Optional[str] = None
    billing_address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    default_tds_pct: float = 0
    default_retention_pct: float = 0
    is_active: bool = True
    confirm_duplicate: bool = False     # same GSTIN as another client: confirm to create anyway


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    gstin: Optional[str] = None
    billing_address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    default_tds_pct: Optional[float] = None
    default_retention_pct: Optional[float] = None
    is_active: Optional[bool] = None


class LeadIn(BaseModel):
    source: str = "OTHER"               # REFERRAL | WEBSITE | EVENT | COLD_CALL | TENDER_PORTAL | PARTNER | OTHER
    client_id: Optional[int] = None
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    estimated_value: Optional[float] = None
    owner_id: Optional[int] = None
    next_followup_at: Optional[str] = None   # YYYY-MM-DD
    note: Optional[str] = None
    confirm_duplicate: bool = False     # same email/phone as an existing lead: confirm to create anyway


class LeadUpdate(BaseModel):
    source: Optional[str] = None
    client_id: Optional[int] = None
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    estimated_value: Optional[float] = None
    owner_id: Optional[int] = None
    next_followup_at: Optional[str] = None


class LeadImport(BaseModel):
    rows: List[LeadIn]
    confirm_duplicate: bool = False     # import rows that look like duplicates too (otherwise they are skipped and reported)


class ActivityIn(BaseModel):
    kind: str                           # CALL | EMAIL | MEETING | NOTE
    body: str
    next_followup_at: Optional[str] = None


class StageMove(BaseModel):
    stage: str                          # NEW | CONTACTED | LOST (QUALIFIED / TENDER / PROPOSAL / WON have their own actions)
    note: str = ""
    lost_reason: Optional[str] = None


class QualifyIn(BaseModel):
    client_id: Optional[int] = None
    create_client: bool = False         # create a client from the lead's company name
    client: Optional[ClientIn] = None   # optional extra client details when creating
    note: str = ""


class TenderIn(BaseModel):
    reference: Optional[str] = None
    due_date: Optional[str] = None
    notes: str = ""


class TenderUpdate(BaseModel):
    reference: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None        # OPEN | SUBMITTED | WON | LOST | CANCELLED
    notes: Optional[str] = None


class ItemIn(BaseModel):
    description: str
    quantity: float = 1
    unit: str = ""
    rate: float = 0
    cost: float = 0


class ProposalIn(BaseModel):
    title: str
    terms: str = ""
    scope_of_work: str = ""
    tax_pct: float = 18
    valid_until: Optional[str] = None
    tender_id: Optional[int] = None
    items: List[ItemIn] = []


class ProposalUpdate(BaseModel):
    title: Optional[str] = None
    terms: Optional[str] = None
    scope_of_work: Optional[str] = None
    tax_pct: Optional[float] = None
    valid_until: Optional[str] = None
    items: Optional[List[ItemIn]] = None


class SendIn(BaseModel):
    to: Optional[str] = None            # defaults to the lead's email
    subject: Optional[str] = None
    message: str = ""
    override_reason: Optional[str] = None   # needed to send a proposal with lines priced below cost (managers only)


class ReviewIn(BaseModel):
    status: str                         # APPROVED | CHANGES_ASKED
    note: str = ""


class WebFormIn(BaseModel):
    name: str = ""
    company: str = ""
    email: str = ""
    phone: str = ""
    message: str = ""
    website: str = ""                   # honeypot: hidden on the page, bots fill it


class PublicReply(BaseModel):
    action: str                         # accept | changes
    message: str = ""
    name: str = ""


class PoIn(BaseModel):
    po_reference: str
    po_date: Optional[str] = None
    contract_no: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    contract_value: Optional[float] = None   # defaults to the proposal total


class ContractUpdate(BaseModel):
    contract_no: Optional[str] = None
    po_reference: Optional[str] = None
    po_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    contract_value: Optional[float] = None
    estimated_cost: Optional[float] = None


class AgreementIn(BaseModel):
    scope_of_work: Optional[str] = None
    agreement_terms: Optional[str] = None
    agreement_status: Optional[str] = None      # NONE | DRAFT | SENT | SIGNED
    agreement_signed_on: Optional[str] = None


class SendDocumentsIn(BaseModel):
    to: Optional[str] = None            # defaults to the client's email
    message: str = ""
    documents: List[str] = ["commercial", "scope"]      # commercial | scope | agreement


class InvoiceEmailIn(BaseModel):
    to: Optional[str] = None
    message: str = ""
    include_scope: bool = False


class ContractStatusIn(BaseModel):
    status: str                         # COMPLETED | TERMINATED
    note: str = ""


class EngagementIn(BaseModel):
    project_id: Optional[int] = None    # link an existing project instead of creating one
    name: Optional[str] = None


class InvoiceIn(BaseModel):
    contract_id: int
    period: str                         # YYYY-MM
    gross_amount: Optional[float] = None    # defaults to the invoice suggestion
    tax_pct: Optional[float] = None
    tds_pct: Optional[float] = None
    retention_pct: Optional[float] = None
    invoice_date: Optional[str] = None
    notes: str = ""


class InvoiceUpdate(BaseModel):
    gross_amount: Optional[float] = None
    tax_pct: Optional[float] = None
    tds_pct: Optional[float] = None
    retention_pct: Optional[float] = None
    invoice_date: Optional[str] = None
    notes: Optional[str] = None


class ReasonIn(BaseModel):
    reason: str


class MonthEndIn(BaseModel):
    month: Optional[str] = None         # YYYY-MM, default the current month


class Allocation(BaseModel):
    invoice_id: int
    amount: float


class PaymentIn(BaseModel):
    client_id: int
    amount: float
    payment_date: str
    reference: Optional[str] = None
    notes: str = ""
    allocations: List[Allocation] = []  # optional: allocated when the payment is posted


class AllocateIn(BaseModel):
    allocations: List[Allocation]


class AdvanceIn(BaseModel):
    client_id: int
    amount: float
    advance_date: str
    reference: Optional[str] = None
    notes: str = ""


class AdjustIn(BaseModel):
    invoice_id: int
    amount: float
