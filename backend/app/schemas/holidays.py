"""Request bodies for holiday management."""

from pydantic import BaseModel


class HolidayIn(BaseModel):
    date: str  # YYYY-MM-DD
    festival: str
