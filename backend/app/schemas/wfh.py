"""Pydantic request models for work-from-home requests."""

from pydantic import BaseModel


class WFHRequest(BaseModel):
    date: str
    reason: str
