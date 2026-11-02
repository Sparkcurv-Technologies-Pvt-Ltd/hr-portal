"""Request bodies for the credential vault."""

from typing import List, Optional

from pydantic import BaseModel


class VaultShare(BaseModel):
    user_id: str
    can_edit: bool = False


class VaultItemCreate(BaseModel):
    title: str
    category: Optional[str] = "General"
    username: Optional[str] = ""
    url: Optional[str] = ""
    secret: str
    notes: Optional[str] = ""
    shares: List[VaultShare] = []


class VaultItemUpdate(BaseModel):
    # Omitted fields are left unchanged; send `secret` only to change the password
    title: Optional[str] = None
    category: Optional[str] = None
    username: Optional[str] = None
    url: Optional[str] = None
    secret: Optional[str] = None
    notes: Optional[str] = None


class VaultSharesUpdate(BaseModel):
    shares: List[VaultShare] = []


class VaultEditorsUpdate(BaseModel):
    user_ids: List[str] = []
