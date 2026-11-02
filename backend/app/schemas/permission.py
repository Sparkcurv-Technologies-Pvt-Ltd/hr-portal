"""Pydantic request models for permission (short leave) requests."""

from pydantic import BaseModel


class PermissionRequest(BaseModel):
    duration_minutes: int
    reason: str
    date: str
