"""Pydantic request models for authentication / user registration."""

from typing import Optional

from pydantic import BaseModel, EmailStr


# Pydantic Models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    department: Optional[str] = "General"
    position: Optional[str] = "Employee"
    role: Optional[str] = "employee"
    employee_code: Optional[str] = None
    date_of_birth: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str
