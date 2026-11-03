"""SSH helpers for the web terminal: host-key pinning, stored-login decryption, session limits and ticket notes.

Logins are stored encrypted (the same Fernet key as the credential vault, ``VAULT_KEY``) and never sent to the browser.
Every server's SSH host key is read once when it is added (or re-pinned by an admin) and connections only succeed
against that exact key, so a man-in-the-middle can't capture a login.
"""

import asyncio
from typing import Optional

import asyncssh
from fastapi import HTTPException

from app.core.vault_crypto import decrypt
from app.db import execute_query
from app.services import monitoring
from app.services.tickets import now_iso

LEVELS = ("l1", "l2")
LEVEL_LABEL = {"l1": "L1", "l2": "L2"}
MAX_SESSIONS_PER_USER = 2
IDLE_TIMEOUT_SECONDS = 15 * 60
MAX_SESSION_SECONDS = 60 * 60
CONNECT_TIMEOUT = 15

_active: dict = {}   # user_id -> number of open terminal sessions (this process)


def try_acquire(user_id: int) -> bool:
    if _active.get(user_id, 0) >= MAX_SESSIONS_PER_USER:
        return False
    _active[user_id] = _active.get(user_id, 0) + 1
    return True

def release(user_id: int) -> None:
    _active[user_id] = max(0, _active.get(user_id, 1) - 1)


async def fetch_host_key(host: str, port: int) -> tuple:
    """Read the server's SSH host key without logging in. Returns (openssh public key line, SHA256 fingerprint)."""
    try:
        await asyncio.get_running_loop().run_in_executor(None, monitoring.resolve_public, host, port)
    except monitoring.Blocked as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError:
        raise HTTPException(status_code=400, detail="Host name could not be resolved")
    try:
        key = await asyncio.wait_for(asyncssh.get_server_host_key(host, port), CONNECT_TIMEOUT)
    except (asyncio.TimeoutError, OSError, asyncssh.Error) as e:
        raise HTTPException(status_code=400, detail=f"Couldn't read the SSH host key from {host}:{port} ({type(e).__name__}). Is SSH running and reachable?")
    return key.export_public_key("openssh").decode().strip(), key.get_fingerprint("sha256")


async def connect_options(server: dict, login: dict) -> dict:
    """Keyword arguments for ``asyncssh.connect`` — pinned host key + the decrypted login."""
    if not server.get("host_key"):
        raise HTTPException(status_code=400, detail="This server has no pinned SSH host key — ask an admin to re-pin it")
    opts = {
        "host": server["host"], "port": server["port"], "username": login["username"],
        "known_hosts": ([asyncssh.import_public_key(server["host_key"])], [], []),
        "connect_timeout": CONNECT_TIMEOUT, "login_timeout": 20, "keepalive_interval": 30,
    }
    secret = decrypt(login["secret_enc"])
    if login["auth_type"] == "key":
        passphrase = decrypt(login["passphrase_enc"]) if login.get("passphrase_enc") else None
        try:
            opts["client_keys"] = [asyncssh.import_private_key(secret, passphrase)]
        except (asyncssh.KeyImportError, asyncssh.KeyEncryptionError) as e:
            raise HTTPException(status_code=400, detail=f"The stored private key can't be read ({e})")
        opts["password"] = None
        opts["agent_path"] = None
    else:
        opts["password"] = secret
        opts["client_keys"] = None
        opts["agent_path"] = None
    return opts


async def ticket_note(ticket_id: Optional[int], user: dict, body: str) -> None:
    """Add an internal note to the ticket being worked on (the session's audit trail on the ticket)."""
    if not ticket_id:
        return
    await execute_query(
        "INSERT INTO ticket_replies (ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES (%s, 'staff', %s, %s, %s, 1, %s)",
        (ticket_id, user["id"], user["name"], body[:1000], now_iso())
    )
    await execute_query("UPDATE tickets SET updated_at = %s WHERE id = %s", (now_iso(), ticket_id))
