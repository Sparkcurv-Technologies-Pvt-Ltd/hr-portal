"""Client server monitoring for staff (``/api/monitoring``) and the reporting endpoint used by the server agent.

Access follows the "monitoring" module of the permission matrix (admins always have everything): View = see monitors
and their history, Edit = add / change / pause monitors, check now, create agent tokens, Delete = remove monitors.
"""

import asyncio
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.core.permissions import effective_module_permissions, has_permission
from app.core.security import get_current_user
from app.db import execute_query
from app.schemas.monitoring import AgentReport, MonitorIn
from app.services import monitoring as svc


monitoring_router = APIRouter(prefix="/monitoring")
HOST_PATTERN = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.\-]*[A-Za-z0-9])?$|^[0-9A-Fa-f:]+$")


async def _has(user: dict, action: str) -> bool:
    if user.get("role") == "admin":
        return True
    return has_permission(await effective_module_permissions(user), "monitoring", action)

async def _require(request: Request, action: str) -> dict:
    user = await get_current_user(request)
    if not await _has(user, action):
        raise HTTPException(status_code=403, detail=f"You don't have {action} access to server monitoring")
    return user

async def _monitor_or_404(monitor_id: int) -> dict:
    m = await execute_query("SELECT * FROM monitors WHERE id = %s", (monitor_id,), fetch_one=True)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return m

def _since(**delta) -> str:
    return (datetime.now(timezone.utc) - timedelta(**delta)).isoformat()

def _pct(ok, total):
    return round(100.0 * float(ok) / total, 2) if total else None

def monitor_out(m: dict, uptime_24h=None, client_name=None) -> dict:
    return {
        "id": m["id"], "client_id": m["client_id"], "client_name": client_name or m.get("client_name"), "name": m["name"], "type": m["type"],
        "target": m["target"], "port": m["port"], "expected_text": m["expected_text"] or "", "interval_seconds": m["interval_seconds"],
        "timeout_seconds": m["timeout_seconds"], "fail_threshold": m["fail_threshold"], "enabled": bool(m["enabled"]),
        "auto_ticket": bool(m["auto_ticket"]), "visible_to_client": bool(m["visible_to_client"]),
        "status": m["status"] if m["enabled"] else "paused", "last_checked_at": m["last_checked_at"], "last_change_at": m["last_change_at"],
        "last_response_ms": m["last_response_ms"], "last_error": m["last_error"], "open_ticket_id": m["open_ticket_id"],
        "open_ticket_number": f"TKT-{m['open_ticket_id']:04d}" if m["open_ticket_id"] else None,
        "last_agent_at": m["last_agent_at"], "has_token": bool(m["agent_token_hash"]),
        "cpu_percent": m["cpu_percent"], "mem_percent": m["mem_percent"], "disk_percent": m["disk_percent"],
        "cpu_max": m["cpu_max"], "mem_max": m["mem_max"], "disk_max": m["disk_max"], "uptime_24h": uptime_24h,
    }

async def _validate(data: MonitorIn) -> dict:
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a name for the monitor")
    if data.type not in svc.TYPES:
        raise HTTPException(status_code=400, detail="Invalid monitor type")
    if not await execute_query("SELECT id FROM clients WHERE id = %s", (data.client_id,), fetch_one=True):
        raise HTTPException(status_code=400, detail="Client not found")
    if not svc.MIN_INTERVAL <= data.interval_seconds <= svc.MAX_INTERVAL:
        raise HTTPException(status_code=400, detail=f"Check interval must be between {svc.MIN_INTERVAL} and {svc.MAX_INTERVAL} seconds")
    if not 2 <= data.timeout_seconds <= 30:
        raise HTTPException(status_code=400, detail="Timeout must be between 2 and 30 seconds")
    if not 1 <= data.fail_threshold <= 10:
        raise HTTPException(status_code=400, detail="Failures before down must be between 1 and 10")
    if not all(1 <= v <= 100 for v in (data.cpu_max, data.mem_max, data.disk_max)):
        raise HTTPException(status_code=400, detail="Resource limits must be between 1 and 100 percent")
    target, port = (data.target or "").strip(), data.port
    if data.type == "http":
        try:
            parts, check_port = svc._split_url(target)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        host, port = parts.hostname, None
    elif data.type == "tcp":
        if not HOST_PATTERN.match(target) or not port or not 1 <= port <= 65535:
            raise HTTPException(status_code=400, detail="Enter a host name or IP address and a port (1–65535)")
        host, check_port = target, port
    else:
        target, port, host = "", None, None
    if host:
        try:
            await asyncio.get_running_loop().run_in_executor(None, svc.resolve_public, host, check_port)
        except svc.Blocked as e:
            raise HTTPException(status_code=400, detail=str(e))
        except OSError:
            pass   # can't resolve right now: allowed, the monitor will simply show as down
    return {"name": name[:200], "target": target[:500], "port": port, "expected_text": (data.expected_text or "")[:255] if data.type == "http" else ""}


# ---------- dashboard ----------

@monitoring_router.get("/summary")
async def summary(request: Request):
    await _require(request, "view")
    rows = await execute_query("SELECT status, enabled, COUNT(*) AS n FROM monitors GROUP BY status, enabled", fetch_all=True)
    out = {"up": 0, "down": 0, "degraded": 0, "unknown": 0, "paused": 0}
    for r in (rows or []):
        out["paused" if not r["enabled"] else r["status"]] += int(r["n"])
    out["total"] = sum(out.values())
    return out

@monitoring_router.get("/monitors")
async def list_monitors(request: Request, client_id: int = 0, status: str = "", q: str = ""):
    await _require(request, "view")
    where, args = [], []
    if client_id:
        where.append("m.client_id = %s"); args.append(client_id)
    if status == "paused":
        where.append("m.enabled = 0")
    elif status:
        where.append("m.enabled = 1 AND m.status = %s"); args.append(status)
    if q.strip():
        where.append("(m.name LIKE %s OR m.target LIKE %s OR cl.name LIKE %s)"); args += [f"%{q.strip()}%"] * 3
    rows = await execute_query(
        "SELECT m.*, cl.name AS client_name FROM monitors m JOIN clients cl ON cl.id = m.client_id" + (" WHERE " + " AND ".join(where) if where else "") +
        " ORDER BY m.enabled = 0, FIELD(m.status, 'down', 'degraded', 'unknown', 'up'), cl.name, m.name", tuple(args), fetch_all=True
    )
    stats = await execute_query("SELECT monitor_id, SUM(ok) AS ok, COUNT(*) AS n FROM monitor_checks WHERE checked_at >= %s GROUP BY monitor_id", (_since(hours=24),), fetch_all=True)
    uptime = {s["monitor_id"]: _pct(s["ok"], s["n"]) for s in (stats or [])}
    return [monitor_out(m, uptime.get(m["id"])) for m in (rows or [])]

@monitoring_router.get("/monitors/{monitor_id}")
async def get_monitor(monitor_id: int, request: Request):
    await _require(request, "view")
    m = await execute_query("SELECT m.*, cl.name AS client_name FROM monitors m JOIN clients cl ON cl.id = m.client_id WHERE m.id = %s", (monitor_id,), fetch_one=True)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    uptime = {}
    for label, delta in (("24h", {"hours": 24}), ("7d", {"days": 7}), ("30d", {"days": 30})):
        s = await execute_query("SELECT SUM(ok) AS ok, COUNT(*) AS n FROM monitor_checks WHERE monitor_id = %s AND checked_at >= %s", (monitor_id, _since(**delta)), fetch_one=True)
        uptime[label] = _pct(s["ok"] or 0, s["n"])
    checks = await execute_query(
        "SELECT checked_at, ok, response_ms, error, cpu_percent, mem_percent, disk_percent FROM monitor_checks WHERE monitor_id = %s AND checked_at >= %s ORDER BY checked_at DESC LIMIT 200",
        (monitor_id, _since(hours=24)), fetch_all=True
    )
    events = await execute_query("SELECT status, detail, created_at FROM monitor_events WHERE monitor_id = %s ORDER BY id DESC LIMIT 30", (monitor_id,), fetch_all=True)
    return {**monitor_out(m, uptime["24h"]), "uptime": uptime, "checks": [{**c, "ok": bool(c["ok"])} for c in reversed(checks or [])], "events": [dict(e) for e in (events or [])]}


# ---------- manage ----------

def _columns(data: MonitorIn, v: dict) -> tuple:
    return (data.client_id, v["name"], data.type, v["target"], v["port"], v["expected_text"], data.interval_seconds, data.timeout_seconds, data.fail_threshold,
            int(data.enabled), int(data.auto_ticket), int(data.visible_to_client), data.cpu_max, data.mem_max, data.disk_max)

@monitoring_router.post("/monitors")
async def create_monitor(data: MonitorIn, request: Request):
    await _require(request, "edit")
    v = await _validate(data)
    token = svc.new_token() if data.type == "agent" else None
    new_id = await execute_query(
        """INSERT INTO monitors (client_id, name, type, target, port, expected_text, interval_seconds, timeout_seconds, fail_threshold, enabled, auto_ticket,
                                 visible_to_client, cpu_max, mem_max, disk_max, agent_token_hash, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        _columns(data, v) + (svc.hash_token(token) if token else None, svc.now_iso()), last_id=True
    )
    return {"id": new_id, "token": token, "message": "Monitor added"}   # the agent token is shown once, here

@monitoring_router.put("/monitors/{monitor_id}")
async def update_monitor(monitor_id: int, data: MonitorIn, request: Request):
    await _require(request, "edit")
    m = await _monitor_or_404(monitor_id)
    if data.type != m["type"]:
        raise HTTPException(status_code=400, detail="A monitor's type can't be changed — add a new monitor instead")
    v = await _validate(data)
    await execute_query(
        """UPDATE monitors SET client_id = %s, name = %s, type = %s, target = %s, port = %s, expected_text = %s, interval_seconds = %s, timeout_seconds = %s,
           fail_threshold = %s, enabled = %s, auto_ticket = %s, visible_to_client = %s, cpu_max = %s, mem_max = %s, disk_max = %s WHERE id = %s""",
        _columns(data, v) + (monitor_id,)
    )
    return {"message": "Monitor updated"}

@monitoring_router.delete("/monitors/{monitor_id}")
async def delete_monitor(monitor_id: int, request: Request):
    await _require(request, "delete")
    await _monitor_or_404(monitor_id)
    for table in ("monitor_checks", "monitor_events"):
        await execute_query(f"DELETE FROM {table} WHERE monitor_id = %s", (monitor_id,))
    await execute_query("DELETE FROM monitors WHERE id = %s", (monitor_id,))
    return {"message": "Monitor deleted"}

@monitoring_router.post("/monitors/{monitor_id}/check")
async def check_now(monitor_id: int, request: Request):
    await _require(request, "edit")
    m = await _monitor_or_404(monitor_id)
    if m["type"] == "agent":
        raise HTTPException(status_code=400, detail="Agent monitors can't be probed — they report on their own")
    await svc.run_probe(m)
    return await get_monitor(monitor_id, request)

@monitoring_router.post("/monitors/{monitor_id}/rotate-token")
async def rotate_token(monitor_id: int, request: Request):
    await _require(request, "edit")
    m = await _monitor_or_404(monitor_id)
    if m["type"] != "agent":
        raise HTTPException(status_code=400, detail="Only agent monitors have a token")
    token = svc.new_token()
    await execute_query("UPDATE monitors SET agent_token_hash = %s WHERE id = %s", (svc.hash_token(token), monitor_id))
    return {"token": token}   # shown once; the old one stops working immediately


# ---------- the agent ----------

AGENT_SCRIPT = '''#!/usr/bin/env python3
"""Sparkcurv server agent: reports CPU, memory and disk usage (Linux). Run it every minute, e.g. from cron:

  * * * * * MONITOR_URL=https://YOUR-PORTAL/api/monitoring/agent/report MONITOR_TOKEN=mon_xxx /usr/bin/python3 /opt/sparkcurv-agent.py
"""
import json, os, shutil, time, urllib.request

URL, TOKEN = os.environ["MONITOR_URL"], os.environ["MONITOR_TOKEN"]

def cpu():
    def read():
        v = [int(x) for x in open("/proc/stat").readline().split()[1:]]
        return v[3] + v[4], sum(v)          # idle (+iowait), total
    i1, t1 = read(); time.sleep(1); i2, t2 = read()
    return round(100 * (1 - (i2 - i1) / (t2 - t1)), 1) if t2 > t1 else 0.0

def mem():
    m = {k: int(v.split()[0]) for k, v in (l.split(":") for l in open("/proc/meminfo"))}
    return round(100 * (1 - m.get("MemAvailable", m["MemFree"]) / m["MemTotal"]), 1)

def disk():
    u = shutil.disk_usage("/")
    return round(100 * u.used / u.total, 1)

body = json.dumps({"cpu_percent": cpu(), "mem_percent": mem(), "disk_percent": disk()}).encode()
req = urllib.request.Request(URL, body, {"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN})
print(urllib.request.urlopen(req, timeout=15).read().decode())
'''

@monitoring_router.get("/agent/script", response_class=PlainTextResponse)
async def agent_script():
    """The agent script (no secrets in it; the token is passed by environment variable)."""
    return AGENT_SCRIPT

@monitoring_router.post("/agent/report")
async def agent_report(data: AgentReport, authorization: str = Header(default="")):
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    m = await execute_query("SELECT * FROM monitors WHERE agent_token_hash = %s AND type = 'agent' AND enabled = 1", (svc.hash_token(token),), fetch_one=True) if token else None
    if not m:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    if not all(0 <= v <= 100 for v in (data.cpu_percent, data.mem_percent, data.disk_percent)):
        raise HTTPException(status_code=400, detail="Percentages must be between 0 and 100")
    accepted = await svc.record_agent_report(m, data.cpu_percent, data.mem_percent, data.disk_percent)
    return {"ok": True, "accepted": accepted}
