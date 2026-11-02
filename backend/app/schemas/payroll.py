"""Pydantic request models for payslips, payroll runs and custom deductions."""

from pydantic import BaseModel


class PayslipGenerate(BaseModel):
    employee_id: str
    month: int
    year: int

class BulkPayrollGenerate(BaseModel):
    month: int
    year: int

class CustomDeductionCreate(BaseModel):
    user_id: int
    deduction_name: str
    amount: float = 0
    is_percentage: bool = False
    percentage: float = 0
    is_active: bool = True
