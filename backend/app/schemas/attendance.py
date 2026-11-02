"""Pydantic request models for attendance."""

from pydantic import BaseModel


class LocationData(BaseModel):
    latitude: float
    longitude: float
