"""Request bodies for Client Management (leads → proposals → contracts → invoices → payments)."""

from typing import List, Optional

from pydantic import BaseModel


class ClientIn(BaseModel):
    """An account (company). Billing details are only needed once invoicing starts."""
    name: str
    gstin: Optional[str] = None
    billing_address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    default_tds_pct: float = 0
    default_retention_pct: float = 0
    is_active: bool = True
    industry: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    account_type: Optional[str] = None      # Prospect | Active Client | Churned | Partner
    owner_id: Optional[int] = None
    notes: Optional[str] = None
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
    industry: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    account_type: Optional[str] = None
    owner_id: Optional[int] = None
    notes: Optional[str] = None


class LeadIn(BaseModel):
    """A lead — the sheet's "Leads" columns."""
    company_name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    location: Optional[str] = None
    source: str = "Other"               # Website | Referral | Cold Call | WhatsApp Inquiry | Social Media | Trade Show / Exhibition | Walk-in | Other
    status: str = "New"                 # New | Contacted | Working | Qualified | Unqualified (Converted comes from converting)
    date_added: Optional[str] = None    # YYYY-MM-DD, default today
    owner_id: Optional[int] = None      # the BDR
    interested_in: Optional[str] = None
    next_action: Optional[str] = None
    confirm_duplicate: bool = False     # same email/phone as an existing lead: confirm to create anyway


class LeadUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None
    status: Optional[str] = None
    date_added: Optional[str] = None
    owner_id: Optional[int] = None
    interested_in: Optional[str] = None
    next_action: Optional[str] = None


class ConvertIn(BaseModel):
    """Convert a lead: find or create its account and open an opportunity."""
    opp_name: Optional[str] = None
    deal_value: Optional[float] = None
    expected_close_date: Optional[str] = None
    industry: Optional[str] = None
    next_action: Optional[str] = None
    notes: Optional[str] = None
    start_cadence: bool = True          # automation: open the follow-up cadence with Email 1 due today


class OpportunityIn(BaseModel):
    client_id: Optional[int] = None     # the account, or ...
    company_name: Optional[str] = None  # ... a company name (the account is found or created)
    opp_name: Optional[str] = None
    contact_person: Optional[str] = None
    stage: str = "Discovery"
    deal_value: Optional[float] = None
    expected_close_date: Optional[str] = None
    lead_source: Optional[str] = None
    owner_id: Optional[int] = None
    next_action: Optional[str] = None
    notes: Optional[str] = None


class OpportunityUpdate(BaseModel):
    opp_name: Optional[str] = None
    contact_person: Optional[str] = None
    stage: Optional[str] = None
    deal_value: Optional[float] = None
    expected_close_date: Optional[str] = None
    lead_source: Optional[str] = None
    owner_id: Optional[int] = None
    next_action: Optional[str] = None
    notes: Optional[str] = None


class FollowupIn(BaseModel):
    opportunity_id: Optional[int] = None
    client_id: Optional[int] = None
    company_name: Optional[str] = None
    contact_person: Optional[str] = None
    owner_id: Optional[int] = None
    notes: Optional[str] = None


class FollowupUpdate(BaseModel):
    contact_person: Optional[str] = None
    owner_id: Optional[int] = None
    notes: Optional[str] = None


class StepIn(BaseModel):
    date: Optional[str] = None          # YYYY-MM-DD; empty clears the step
    outcome: Optional[str] = None       # Pending | Completed | No Response | Skipped | Rescheduled


class ActivityIn(BaseModel):
    log_date: Optional[str] = None      # YYYY-MM-DD, default today
    owner_id: Optional[int] = None      # the BDR, default you
    company_name: Optional[str] = None
    client_id: Optional[int] = None
    activity_type: str = "Call"         # Email | Call | WhatsApp | Note
    outcome: Optional[str] = "Completed"
    notes: Optional[str] = None


class ActivityUpdate(BaseModel):
    log_date: Optional[str] = None
    owner_id: Optional[int] = None
    company_name: Optional[str] = None
    activity_type: Optional[str] = None
    outcome: Optional[str] = None
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
