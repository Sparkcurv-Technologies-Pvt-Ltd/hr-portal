"""Encryption for credential-vault secrets (Fernet: AES-128-CBC + HMAC-SHA256).

The key lives only in the VAULT_KEY environment variable (backend/.env), never in the database,
so a database dump alone doesn't expose stored passwords.
"""

import os

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException


def _fernet() -> Fernet:
    key = os.environ.get("VAULT_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Vault is not configured (VAULT_KEY missing on the server)")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise HTTPException(status_code=503, detail="Vault key on the server is invalid")


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt((plaintext or "").encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        raise HTTPException(status_code=500, detail="Stored secret could not be decrypted (vault key changed?)")
