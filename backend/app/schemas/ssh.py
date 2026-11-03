"""Request bodies for the SSH terminal."""

from typing import Optional

from pydantic import BaseModel


class SshServerIn(BaseModel):
    client_id: int
    name: str
    host: str
    port: int = 22


class SshLoginIn(BaseModel):
    username: str
    auth_type: str                      # password | key
    secret: str = ""                    # the password, or the private key (PEM); blank = keep the stored one
    passphrase: Optional[str] = None    # key passphrase; None = keep, "" = remove


class SshTeamIn(BaseModel):
    level: Optional[str] = None         # l1 | l2 | null (not on the team)
