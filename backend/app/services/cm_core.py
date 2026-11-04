"""Client Management: shared vocabularies, money maths, access levels and small helpers.

Who can do what (the existing role system: admins always everything, other people through the permission matrix):

- **Sales** matrix row — View: read every client, lead, proposal and contract. Edit = the *Sales* role: create leads and proposals,
  work only the ones they own. Delete = the *Manager* role: works anyone's, approves proposal reviews, books POs, creates engagements,
  may override a below-cost send.
- **Accounts** matrix row — View: read invoices, payments, advances and the client ledger. Edit = the *Accounts* role: draft, post and
  reverse invoices, record and allocate payments and advances.
- Anyone else (including managers and employees without a grant) gets no access at all.
"""

import re
import secrets
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from fastapi import HTTPException

from app.core.permissions import effective_module_permissions
from app.db import execute_query

# The Sales CRM sheet's dropdown lists ("Lists" sheet)
LEAD_SOURCES = ("Website", "Referral", "Cold Call", "WhatsApp Inquiry", "Social Media", "Trade Show / Exhibition", "Walk-in", "Other")
LEAD_STATUSES = ("New", "Contacted", "Working", "Qualified", "Unqualified", "Converted")
INDUSTRIES = ("Construction", "Real Estate", "Architecture", "Interior Design", "Finance", "Manufacturing", "Other")
OPP_STAGES = ("Discovery", "Demo Completed", "Pricing/POC Discussion", "Qualified", "Closed Won", "Closed Lost")
OPEN_OPP_STAGES = OPP_STAGES[:4]
STAGE_PROBABILITY = {"Discovery": 10, "Demo Completed": 30, "Pricing/POC Discussion": 50, "Qualified": 70, "Closed Won": 100, "Closed Lost": 0}
ACCOUNT_TYPES = ("Prospect", "Active Client", "Churned", "Partner")
FOLLOWUP_OUTCOMES = ("Pending", "Completed", "No Response", "Skipped", "Rescheduled")
ACTIVITY_TYPES = ("Email", "Call", "WhatsApp", "Note")
CADENCE_GAP_DAYS = (2, 3, 2, 3, 2, 3, 2, 3, 2)     # automation: when a touch is done, the next one is scheduled this many days later (weekends skipped)
CADENCE = ("Email 1", "Call 1", "Email 2", "Call 2", "Email 3", "Call 3", "Email 4", "Call 4", "Email 5", "Call 5")   # standard cadence per opportunity
PROPOSAL_STATUSES = ("DRAFT", "SENT", "ACCEPTED", "REJECTED")
REVIEW_STATUSES = ("PENDING", "CHANGES_ASKED", "APPROVED")
CONTRACT_STATUSES = ("DRAFT", "ACTIVE", "COMPLETED", "TERMINATED")
INVOICE_STATUSES = ("DRAFT", "POSTED", "CANCELLED")
PAYMENT_STATUSES = ("DRAFT", "POSTED", "CANCELLED")
ADVANCE_STATUSES = ("OPEN", "PARTLY_ADJUSTED", "ADJUSTED", "CANCELLED")
OVERDUE_DAYS = 60

CENT = Decimal("0.01")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def today() -> date:
    from app.core.config import APP_TIMEZONE
    return datetime.now(timezone.utc).astimezone(APP_TIMEZONE).date()

def D(value) -> Decimal:
    """Any number (or None) → Decimal rounded to cents. Floats go through str() so 0.1 stays 0.10."""
    return Decimal(str(value if value is not None else 0)).quantize(CENT, rounding=ROUND_HALF_UP)

def F(value) -> Optional[float]:
    return None if value is None else float(D(value))

def pct(amount: Decimal, percent) -> Decimal:
    return (amount * Decimal(str(percent or 0)) / Decimal(100)).quantize(CENT, rounding=ROUND_HALF_UP)

def check(value, allowed: tuple, label: str):
    if value not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {label}. Use one of: {', '.join(allowed)}")
    return value

def clean_date(value: Optional[str], label: str) -> Optional[str]:
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be in YYYY-MM-DD format")

def clean_period(value: str) -> str:
    try:
        return datetime.strptime((value or "").strip(), "%Y-%m").strftime("%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="Period must be in YYYY-MM format")

def check_pct(value, label: str) -> float:
    v = float(value or 0)
    if not 0 <= v <= 100:
        raise HTTPException(status_code=400, detail=f"{label} must be between 0 and 100")
    return v

def norm_email(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return e or None

def valid_email(email: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""))

def norm_phone(phone: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 7 else None

def temp_code() -> str:
    """Codes are PREFIX-<id>: insert with a unique placeholder, then rewrite it once the id is known."""
    return f"tmp-{secrets.token_hex(6)}"

def format_code(prefix: str, row_id: int, width: int = 4) -> str:
    return f"{prefix}-{row_id:0{width}d}"

def new_token() -> str:
    return secrets.token_urlsafe(32)


# ---------- access ----------

class Ctx:
    """``sales``: 'mgr' | 'sales' | 'viewer' | None; ``acct``: 'acct' | 'viewer' | None."""
    def __init__(self, user: dict, sales: Optional[str], acct: Optional[str]):
        self.user, self.sales, self.acct = user, sales, acct
        self.is_admin = user.get("role") == "admin"

    @property
    def uid(self) -> int:
        return self.user["id"]

    @property
    def name(self) -> str:
        return self.user["name"]

    @property
    def any_access(self) -> bool:
        return bool(self.sales or self.acct)

    @property
    def sees_all_sales(self) -> bool:
        return self.sales in ("mgr", "viewer")

    def owns(self, owner_id) -> bool:
        return self.sales == "mgr" or (self.sales == "sales" and owner_id == self.uid)


async def build_ctx(user: dict) -> Ctx:
    if user.get("role") == "admin":
        return Ctx(user, "mgr", "acct")
    perms = await effective_module_permissions(user)
    s, a = perms.get("sales"), perms.get("accounts")
    sales = ("mgr" if s["delete"] else "sales" if s["edit"] else "viewer" if s["view"] else None) if s else None
    acct = ("acct" if (a["edit"] or a["delete"]) else "viewer" if a["view"] else None) if a else None
    return Ctx(user, sales, acct)

def require_any(ctx: Ctx) -> None:
    if not ctx.any_access:
        raise HTTPException(status_code=403, detail="You don't have access to client management")

def require_sales_read(ctx: Ctx) -> None:
    if not ctx.sales:
        raise HTTPException(status_code=403, detail="You don't have access to sales data")

def require_sales_edit(ctx: Ctx) -> None:
    if ctx.sales not in ("sales", "mgr"):
        raise HTTPException(status_code=403, detail="Only the Sales role can do this")

def require_manager(ctx: Ctx) -> None:
    if ctx.sales != "mgr":
        raise HTTPException(status_code=403, detail="Only a sales manager can do this")

def require_accounts(ctx: Ctx) -> None:
    if ctx.acct != "acct":
        raise HTTPException(status_code=403, detail="Only Accounts can do this")

def require_accounts_read(ctx: Ctx) -> None:
    if not ctx.acct:
        raise HTTPException(status_code=403, detail="You don't have access to accounts data")


# ---------- shared lookups ----------

async def user_or_400(user_id: Optional[int], label: str) -> Optional[dict]:
    if user_id is None:
        return None
    u = await execute_query("SELECT id, name, email FROM users WHERE id = %s", (user_id,), fetch_one=True)
    if not u:
        raise HTTPException(status_code=400, detail=f"{label} not found")
    return u

async def client_or_404(client_id: int) -> dict:
    c = await execute_query("SELECT * FROM clients WHERE id = %s", (client_id,), fetch_one=True)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")
    return c

async def log_activity(company_name: str, notes: str, *, activity_type: str = "Note", outcome: Optional[str] = "Completed", ctx: Optional[Ctx] = None, by_name: str = "System",
                       owner_id: Optional[int] = None, bdr_label: Optional[str] = None, client_id: Optional[int] = None, lead_id: Optional[int] = None,
                       opportunity_id: Optional[int] = None, followup_id: Optional[int] = None, followup_step: Optional[int] = None, log_date: Optional[str] = None) -> int:
    """One row in the activity log (the sheet's "Activity Log"): who did what, when, with which company and what came of it."""
    who = owner_id if owner_id is not None else (ctx.uid if ctx and bdr_label is None else None)
    label = bdr_label or (ctx.name if ctx else by_name)
    aid = await execute_query(
        """INSERT INTO activity_log (code, log_date, owner_id, bdr_label, client_id, lead_id, opportunity_id, followup_id, followup_step, company_name, activity_type, outcome, notes, created_by, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (temp_code(), log_date or today().isoformat(), who, label, client_id, lead_id, opportunity_id, followup_id, followup_step, (company_name or "—")[:255], activity_type, outcome,
         (notes or "")[:4000], ctx.uid if ctx else None, now_iso()), last_id=True)
    await execute_query("UPDATE activity_log SET code = %s WHERE id = %s", (format_code("AL", aid), aid))
    return aid
