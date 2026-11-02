"""Pydantic request models for admin settings, org chart and portal reset."""

from typing import Optional

from pydantic import BaseModel


class OfficeSettingsUpdate(BaseModel):
    latitude: float
    longitude: float
    radius_km: float = 0.5
    office_name: str = "Main Headquarters (Nagercoil)"
    address: str = "64/3, Thompson St, Palace Rd, Nagercoil, Tamil Nadu 629001"
    geofence_bypass: bool = False


# ── Org Chart ─────────────────────────────────────────────────────────────────
class OrgNodeCreate(BaseModel):
    employee_name: str
    job_title: Optional[str] = ""
    image_url: Optional[str] = ""
    description: Optional[str] = ""
    parent_id: Optional[int] = None
    level_num: Optional[int] = 0
    sort_order: Optional[int] = 0

class OrgNodeUpdate(BaseModel):
    employee_name: Optional[str] = None
    job_title: Optional[str] = None
    image_url: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None
    level_num: Optional[int] = None
    sort_order: Optional[int] = None

