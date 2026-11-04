"""Client Management reminders (same pattern as the attendance reminders): at most one email per person per day per kind, claimed in ``reminder_log``.

- Follow-ups: Mon–Fri from CM_REMINDER_TIME (default 09:00 office time) — each lead owner gets one digest of their leads due today or overdue.
- Receivables: Mondays at the same time — people with Accounts access get the list of invoices outstanding for more than 60 days.
"""

import asyncio
from datetime import datetime, timezone

from app.core.config import APP_TIMEZONE, CM_REMINDER_TIME, CLIENT_MGMT_REMINDERS_ENABLED
from app.core.email import _cm_followup_digest_email_html, _cm_receivables_email_html, _send_email
from app.core.log import logger
from app.db import execute_query
from app.services import cm_core as core
from app.services.cm_reports import receivables_aging
from app.services.reminders import _claim, _minutes

CHECK_INTERVAL_SECONDS = 300
WINDOW_HOURS = 3        # still send if the server was down at the reminder time, but not hours later


def _in_window(now_local: datetime) -> bool:
    start = _minutes(CM_REMINDER_TIME, 9 * 60)
    minutes = now_local.hour * 60 + now_local.minute
    return start <= minutes < start + WINDOW_HOURS * 60


def _send(to: str, subject: str, html_body: str) -> None:
    asyncio.get_event_loop().run_in_executor(None, _send_email, [to], subject, html_body, "sales")


async def send_followup_digests(now_local: datetime) -> int:
    """One digest per BDR: cadence touches that are due today or overdue (a date on or before today with no outcome yet, or marked Pending / Rescheduled)."""
    if now_local.weekday() >= 5 or not _in_window(now_local):
        return 0
    today = now_local.strftime("%Y-%m-%d")
    due_sql = ("FROM followup_steps s JOIN followups f ON f.id = s.followup_id WHERE s.step_date IS NOT NULL AND s.step_date <= %s AND (s.outcome IS NULL OR s.outcome IN ('Pending', 'Rescheduled'))")
    owners = await execute_query(
        f"""SELECT u.id, u.name, u.email FROM users u WHERE u.email IS NOT NULL AND u.email != ''
             AND EXISTS (SELECT 1 {due_sql} AND f.owner_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.user_id = u.id AND r.date = %s AND r.kind = 'cm_followup')""", (today, today), fetch_all=True)
    sent = 0
    for o in (owners or []):
        if not await _claim(o["id"], today, "cm_followup"):
            continue
        steps = await execute_query(f"SELECT f.company_name, s.step_no, s.step_date {due_sql} AND f.owner_id = %s ORDER BY s.step_date", (today, o["id"]), fetch_all=True)
        rows = [(r["company_name"], core.CADENCE[r["step_no"] - 1], r["step_date"], (now_local.date() - datetime.strptime(r["step_date"], "%Y-%m-%d").date()).days) for r in (steps or [])]
        _send(o["email"], f"Follow-ups due: {len(rows)} touch{'es' if len(rows) != 1 else ''}", _cm_followup_digest_email_html(o["name"], rows))
        sent += 1
    if sent:
        logger.info(f"Client management follow-up digests sent: {sent}")
    return sent


async def send_receivables_digest(now_local: datetime) -> int:
    if now_local.weekday() != 0 or not _in_window(now_local):
        return 0
    today = now_local.strftime("%Y-%m-%d")
    candidates = await execute_query("SELECT * FROM users WHERE email IS NOT NULL AND email != '' AND (role = 'admin' OR id IN (SELECT user_id FROM user_permissions WHERE module = 'accounts' AND can_view = 1))", fetch_all=True)
    sent, report = 0, None
    for u in (candidates or []):
        ctx = await core.build_ctx(dict(u))
        if not ctx.acct:
            continue
        if report is None:
            report = [i for i in (await receivables_aging(ctx))["invoices"] if i["age_days"] > core.OVERDUE_DAYS]
        if not report:
            return 0
        if not await _claim(u["id"], today, "cm_receivables"):
            continue
        rows = [(i["client"], i["code"], i["outstanding"], i["age_days"]) for i in report]
        _send(u["email"], f"{len(rows)} invoice(s) overdue by more than 60 days", _cm_receivables_email_html(rows, sum(r[2] for r in rows)))
        sent += 1
    if sent:
        logger.info(f"Client management receivables digests sent: {sent}")
    return sent


async def _loop() -> None:
    while True:
        try:
            now_local = datetime.now(timezone.utc).astimezone(APP_TIMEZONE)
            await send_followup_digests(now_local)
            await send_receivables_digest(now_local)
        except Exception as e:
            logger.warning(f"Client management reminder error: {e}")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


def start_cm_reminder_scheduler() -> None:
    if CLIENT_MGMT_REMINDERS_ENABLED:
        asyncio.create_task(_loop())
        logger.info(f"Client management reminders started (follow-ups Mon–Fri and receivables on Mondays, from {CM_REMINDER_TIME})")
