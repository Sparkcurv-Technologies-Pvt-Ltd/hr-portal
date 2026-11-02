"""Pydantic request models for leave requests and leave balances."""

from typing import Optional

from pydantic import BaseModel


class LeaveRequest(BaseModel):
    leave_type: str
    start_date: str
    end_date: str
    reason: str
    is_half_day: bool = False


# ── Leave Balance ─────────────────────────────────────────────────────────────
class LeaveBalanceUpdate(BaseModel):
    casual_leave: Optional[float] = None
    sick_leave: Optional[float] = None
    loss_of_pay: Optional[float] = None
    permission_hours: Optional[float] = None
    wfh_limit: Optional[int] = None
