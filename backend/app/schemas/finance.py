"""Pydantic request models for income/expense finance tracking."""

from pydantic import BaseModel


class FinanceCategoryCreate(BaseModel):
    name: str
    type: str  # income | expense
