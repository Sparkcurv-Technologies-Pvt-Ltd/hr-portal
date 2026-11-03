"""Client server monitoring: probes, state changes, alerts and tickets.

Three kinds of monitor:
- ``http``  — the portal requests a URL; up if it answers with a status below 400 (and contains the expected text, if set).
- ``tcp``   — the portal opens a connection to host:port.
- ``agent`` — a small script on the client's server reports CPU / memory / disk; it counts as down when reports stop.

A monitor is only marked down after ``fail_threshold`` failed checks in a row (so one blip doesn't alert). Going down emails
the team and (optionally) opens an urgent ticket for the client; recovering emails again and resolves that ticket.
Probes to private / loopback addresses are refused unless ``MONITOR_ALLOW_PRIVATE`` is on, so the portal can't be used to
scan its own network.
"""

import asyncio
import hashlib
import ipaddress
import secrets
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import MONITOR_ALLOW_PRIVATE, TICKET_NOTIFY_EMAILS, FRONTEND_URL
from app.core.email import _send_email, _ticket_email_html
from app.core.log import logger
from app.db import execute_query
from app.services import tickets as ticket_svc

TYPES = ("http", "tcp", "agent")
MIN_INTERVAL, MAX_INTERVAL = 60, 3600
LOOP_SECONDS = 15
MAX_CONCURRENT = 20
CHECK_RETENTION_DAYS = 30
EVENT_RETENTION_DAYS = 180
AGENT_STALE_FACTOR = 3          # no report for this many intervals = down
MIN_REPORT_GAP_SECONDS = 10     # ignore agents that report more often than this


class Blocked(Exception):
    """The target resolves to an address we refuse to probe."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse(iso: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(iso) if iso else None


# ---------- tokens (agent) ----------

def new_token() -> str:
    return "mon_" + secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- address safety ----------

def _blocked_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved or addr.is_unspecified

def resolve_public(host: str, port: int) -> list:
    """Resolve ``host`` and make sure none of its addresses is internal. Blocking (use ``run_in_executor``)."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    ips = list(dict.fromkeys(i[4][0] for i in infos))
    if not MONITOR_ALLOW_PRIVATE and any(_blocked_ip(ip) for ip in ips):
        raise Blocked("That address is private or internal, so it can't be monitored from the portal")
    return ips

def _split_url(url: str):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("Enter a full URL starting with http:// or https://")
    return parts, parts.port or (443 if parts.scheme == "https" else 80)


# ---------- probes ----------

class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follow redirects, but never to an internal address."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts, port = _split_url(urllib.parse.urljoin(req.full_url, newurl))
        resolve_public(parts.hostname, port)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def _http_probe(url: str, expected_text: str, timeout: int) -> tuple:
    parts, port = _split_url(url)
    resolve_public(parts.hostname, port)
    opener = urllib.request.build_opener(_SafeRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": "SparkcurvMonitor/1.0"})
    start = time.monotonic()
    with opener.open(req, timeout=timeout) as resp:
        body = resp.read(200_000) if expected_text else b""
        ms = int((time.monotonic() - start) * 1000)
        if resp.status >= 400:
            return False, ms, f"HTTP {resp.status}"
    if expected_text and expected_text not in body.decode("utf-8", "ignore"):
        return False, ms, "Expected text not found on the page"
    return True, ms, None

async def check_http(url: str, expected_text: str, timeout: int) -> tuple:
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, _http_probe, url, expected_text or "", timeout)
    except Blocked as e:
        return False, None, str(e)
    except urllib.error.HTTPError as e:
        return False, None, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return False, None, f"Connection failed: {e.reason}"[:480]
    except (TimeoutError, socket.timeout):
        return False, None, f"Timed out after {timeout}s"
    except Exception as e:
        return False, None, f"{type(e).__name__}: {e}"[:480]

async def check_tcp(host: str, port: int, timeout: int) -> tuple:
    loop = asyncio.get_running_loop()
    try:
        ips = await loop.run_in_executor(None, resolve_public, host, port)
        start = time.monotonic()
        _, writer = await asyncio.wait_for(asyncio.open_connection(ips[0], port), timeout)
        ms = int((time.monotonic() - start) * 1000)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True, ms, None
    except Blocked as e:
        return False, None, str(e)
    except asyncio.TimeoutError:
        return False, None, f"Timed out after {timeout}s"
    except socket.gaierror:
        return False, None, "Host name could not be resolved"
    except OSError as e:
        return False, None, f"Connection failed: {e.strerror or e}"[:480]


# ---------- state changes ----------

async def _create_down_ticket(m: dict, error: str) -> Optional[int]:
    if not m["auto_ticket"]:
        return None
    existing = m.get("open_ticket_id")
    if existing:
        row = await execute_query("SELECT status FROM tickets WHERE id = %s", (existing,), fetch_one=True)
        if row and row["status"] in ticket_svc.OPEN_STATUSES:
            return existing
    now = now_iso()
    ticket_id = await execute_query(
        """INSERT INTO tickets (client_id, contact_id, subject, description, category, priority, status, due_at, created_at, updated_at)
           VALUES (%s, NULL, %s, %s, 'support', 'urgent', 'open', %s, %s, %s)""",
        (m["client_id"], f"Server down: {m['name']}"[:255], f"Server monitoring detected that {m['name']} is down.\nReason: {error or 'no response'}",
         ticket_svc.sla_due("urgent"), now, now), last_id=True
    )
    await ticket_svc.log_change(ticket_id, "Server monitoring", "created", None, ticket_svc.number(ticket_id))
    return ticket_id

async def _resolve_ticket(m: dict, down_for: str) -> None:
    ticket_id = m.get("open_ticket_id")
    if not ticket_id:
        return
    row = await execute_query("SELECT status FROM tickets WHERE id = %s", (ticket_id,), fetch_one=True)
    if not row or row["status"] not in ticket_svc.OPEN_STATUSES:
        return
    now = now_iso()
    await execute_query(
        "INSERT INTO ticket_replies (ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES (%s, 'staff', NULL, 'Server monitoring', %s, 1, %s)",
        (ticket_id, f"Recovered automatically: {m['name']} is back up (was down for {down_for}).", now)
    )
    await execute_query("UPDATE tickets SET status = 'resolved', resolved_at = %s, updated_at = %s WHERE id = %s", (now, now, ticket_id))
    await ticket_svc.log_change(ticket_id, "Server monitoring", "status", row["status"], "resolved")

def _alert(m: dict, client_name: str, down: bool, detail: str, ticket_no: Optional[str]) -> None:
    fields = [("Client", client_name), ("Monitor", f"{m['name']} ({m['type'].upper()})")]
    if m["type"] != "agent" and m.get("target"):
        fields.append(("Target", m["target"] + (f":{m['port']}" if m.get("port") else "")))
    fields.append(("Down for" if not down else "Reason", detail))
    if ticket_no:
        fields.append(("Ticket", ticket_no))
    page = _ticket_email_html(
        f"Server down: {m['name']}" if down else f"Server recovered: {m['name']}", client_name, m["name"], fields,
        "A client server stopped responding." if down else "The server is responding again.", accent="red" if down else "green",
        url=f"{FRONTEND_URL.rstrip('/')}/login", button="Open the portal", eyebrow="Server monitoring")
    subject = f"{'DOWN' if down else 'Recovered'}: {m['name']} ({client_name})"
    asyncio.get_running_loop().run_in_executor(None, _send_email, list(TICKET_NOTIFY_EMAILS), subject, page, "monitoring")

def _human(delta: timedelta) -> str:
    s = int(delta.total_seconds())
    h, rem = divmod(s, 3600)
    mnt = rem // 60
    return f"{h}h {mnt}m" if h else f"{mnt}m" if mnt else f"{s}s"

async def record(m: dict, ok: bool, ms: Optional[int], error: Optional[str], *, cpu=None, mem=None, disk=None) -> None:
    """Store one check result and apply the status change it causes."""
    now = now_iso()
    await execute_query(
        "INSERT INTO monitor_checks (monitor_id, checked_at, ok, response_ms, error, cpu_percent, mem_percent, disk_percent) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (m["id"], now, int(ok), ms, error, cpu, mem, disk)
    )
    old = m["status"]
    if ok:
        failures = 0
        degraded = m["type"] == "agent" and ((cpu or 0) > m["cpu_max"] or (mem or 0) > m["mem_max"] or (disk or 0) > m["disk_max"])
        new = "degraded" if degraded else "up"
    else:
        failures = m["consecutive_failures"] + 1
        new = "down" if failures >= m["fail_threshold"] else old
    changed = new != old
    ticket_id = m.get("open_ticket_id")
    detail = error or ("Resource usage above the limit" if new == "degraded" else None)
    if changed:
        await execute_query("INSERT INTO monitor_events (monitor_id, status, detail, created_at) VALUES (%s, %s, %s, %s)", (m["id"], new, detail, now))
    sets = "last_checked_at = %s, last_response_ms = %s, last_error = %s, consecutive_failures = %s, status = %s"
    args = [now, ms, error, failures, new]
    if changed:
        sets += ", last_change_at = %s"; args.append(now)
    if cpu is not None:
        sets += ", cpu_percent = %s, mem_percent = %s, disk_percent = %s"; args += [cpu, mem, disk]
    if changed and new == "down":
        ticket_id = await _create_down_ticket(m, error or "")
        sets += ", open_ticket_id = %s"; args.append(ticket_id)
    await execute_query(f"UPDATE monitors SET {sets} WHERE id = %s", tuple(args) + (m["id"],))

    if not changed:
        return
    client = await execute_query("SELECT name FROM clients WHERE id = %s", (m["client_id"],), fetch_one=True)
    client_name = client["name"] if client else "—"
    if new == "down":
        _alert(m, client_name, True, error or "No response", ticket_svc.number(ticket_id) if ticket_id else None)
        logger.warning(f"Monitor down: {m['name']} ({client_name}): {error}")
    elif old == "down":
        down_for = _human(datetime.now(timezone.utc) - (_parse(m.get("last_change_at")) or datetime.now(timezone.utc)))
        await _resolve_ticket(m, down_for)
        await execute_query("UPDATE monitors SET open_ticket_id = NULL WHERE id = %s", (m["id"],))
        _alert(m, client_name, False, down_for, ticket_svc.number(ticket_id) if ticket_id else None)
        logger.info(f"Monitor recovered: {m['name']} ({client_name}) after {down_for}")


async def run_probe(m: dict) -> None:
    """Probe an http / tcp monitor now and record the result."""
    if m["type"] == "http":
        ok, ms, error = await check_http(m["target"], m.get("expected_text") or "", m["timeout_seconds"])
    else:
        ok, ms, error = await check_tcp(m["target"], m["port"], m["timeout_seconds"])
    await record(m, ok, ms, error)

async def check_agent_heartbeat(m: dict) -> None:
    """An agent monitor is down once its reports stop (it stays 'unknown' until the first report)."""
    last = _parse(m.get("last_agent_at"))
    if not last:
        await execute_query("UPDATE monitors SET last_checked_at = %s WHERE id = %s", (now_iso(), m["id"]))
        return
    silent = datetime.now(timezone.utc) - last
    if silent > timedelta(seconds=m["interval_seconds"] * AGENT_STALE_FACTOR):
        await record(m, False, None, f"No report received for {_human(silent)}")
    else:
        await execute_query("UPDATE monitors SET last_checked_at = %s WHERE id = %s", (now_iso(), m["id"]))

async def record_agent_report(m: dict, cpu: float, mem: float, disk: float) -> bool:
    """Handle a report from the agent. Returns False when it came too soon after the previous one (ignored)."""
    last = _parse(m.get("last_agent_at"))
    if last and (datetime.now(timezone.utc) - last).total_seconds() < MIN_REPORT_GAP_SECONDS:
        return False
    await execute_query("UPDATE monitors SET last_agent_at = %s WHERE id = %s", (now_iso(), m["id"]))
    await record(m, True, None, None, cpu=round(cpu, 1), mem=round(mem, 1), disk=round(disk, 1))
    return True


# ---------- scheduler ----------

async def _run_due(sem: asyncio.Semaphore) -> None:
    now = datetime.now(timezone.utc)
    rows = await execute_query("SELECT * FROM monitors WHERE enabled = 1", fetch_all=True)
    jobs = []
    for m in (rows or []):
        last = _parse(m["last_checked_at"])
        if last and now - last < timedelta(seconds=m["interval_seconds"]):
            continue
        # claim it (compare-and-set on last_checked_at) so several backend processes don't probe the same monitor twice
        claimed = await execute_query("UPDATE monitors SET last_checked_at = %s WHERE id = %s AND last_checked_at <=> %s", (now_iso(), m["id"], m["last_checked_at"]))
        if claimed == 1:
            jobs.append(m)

    async def one(m):
        async with sem:
            try:
                await (check_agent_heartbeat(m) if m["type"] == "agent" else run_probe(m))
            except Exception as e:
                logger.warning(f"Monitor check failed for {m['name']}: {e}")
    await asyncio.gather(*(one(m) for m in jobs))

async def _prune() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=CHECK_RETENTION_DAYS)).isoformat()
    await execute_query("DELETE FROM monitor_checks WHERE checked_at < %s", (cutoff,))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=EVENT_RETENTION_DAYS)).isoformat()
    await execute_query("DELETE FROM monitor_events WHERE created_at < %s", (cutoff,))

async def _loop() -> None:
    sem = asyncio.Semaphore(MAX_CONCURRENT)
    last_prune = 0.0
    while True:
        try:
            await _run_due(sem)
            if time.monotonic() - last_prune > 86400:
                await _prune(); last_prune = time.monotonic()
        except Exception as e:
            logger.warning(f"Monitoring scheduler error: {e}")
        await asyncio.sleep(LOOP_SECONDS)

def start_monitor_scheduler() -> None:
    asyncio.create_task(_loop())
    logger.info("Client server monitoring started")
