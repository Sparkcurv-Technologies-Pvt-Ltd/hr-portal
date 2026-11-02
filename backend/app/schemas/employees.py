"""Pydantic request models for employee administration."""

from typing import Optional

from pydantic import BaseModel


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    casual_leave: Optional[float] = None
    sick_leave: Optional[float] = None
    permission_hours: Optional[float] = None
    shift: Optional[str] = None
    role: Optional[str] = None
    wfh_limit: Optional[int] = None
    employee_code: Optional[str] = None
    reporting_manager_id: Optional[int] = None
    date_of_birth: Optional[str] = None


class SalaryUpdate(BaseModel):
    basic_salary: float


class ShiftAssign(BaseModel):
    start_time: str  # HH:MM
    end_time: str    # HH:MM

class PasswordReset(BaseModel):
    new_password: str
