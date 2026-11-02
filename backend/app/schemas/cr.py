"""Pydantic request models for change requests."""

from typing import Optional

from pydantic import BaseModel


class CRCreate(BaseModel):
    title: str
    description: str
    cr_type: str = "General"
    priority: str = "medium"
    metadata: Optional[dict] = None

class CRUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cr_type: Optional[str] = None
    priority: Optional[str] = None
