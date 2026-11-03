"""Request bodies for client ticketing."""

from typing import Optional

from pydantic import BaseModel


class ClientIn(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""
    notes: str = ""
    status: str = "active"   # active | inactive


class ContactIn(BaseModel):
    name: str
    email: str
    phone: str = ""
    password: str = ""       # initial login password (staff share it with the contact)


class ContactUpdate(BaseModel):
    name: str
    phone: str = ""
    active: bool = True
    password: str = ""       # blank = keep the current password


class TicketIn(BaseModel):
    client_id: int
    contact_id: Optional[int] = None
    subject: str
    description: str = ""
    category: str = "support"
    priority: str = "medium"
    assignee_id: Optional[int] = None
    due_at: Optional[str] = None   # ISO datetime; blank = SLA from priority


class TicketUpdate(BaseModel):
    subject: str
    description: str = ""
    category: str = "support"
    priority: str = "medium"
    status: str = "open"
    assignee_id: Optional[int] = None
    due_at: Optional[str] = None


class TicketStatusIn(BaseModel):
    status: str


class ReplyIn(BaseModel):
    body: str
    internal: bool = False   # staff-only note, never shown to the client


class ClientLogin(BaseModel):
    email: str
    password: str


class ClientTicketIn(BaseModel):
    subject: str
    description: str = ""
    category: str = "support"
    priority: str = "medium"
