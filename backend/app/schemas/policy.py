"""Pydantic request models for company policies."""

from typing import Optional

from pydantic import BaseModel


class PolicyCreate(BaseModel):
    title: str
    category: str
    content: str
    icon: Optional[str] = "article"
    sort_order: Optional[int] = 0

class PolicyUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
