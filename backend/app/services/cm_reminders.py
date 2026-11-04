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
    if now_local.weekday() >= 5 or not _in_window(now_local):
        return 0
    today = now_local.strftime("%Y-%m-%d")
    owners = await execute_query(
        """SELECT u.id, u.name, u.email FROM users u WHERE u.email IS NOT NULL AND u.email != ''
             AND EXISTS (SELECT 1 FROM leads l WHERE l.owner_id = u.id AND l.next_followup_at IS NOT NULL AND l.next_followup_at <= %s
                         AND l.stage IN ('NEW','CONTACTED','QUALIFIED','TENDER','PROPOSAL'))
             AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.user_id = u.id AND r.date = %s AND r.kind = 'cm_followup')""", (today, today), fetch_all=True)
    sent = 0
    for o in (owners or []):
        if not await _claim(o["id"], today, "cm_followup"):
            continue
        leads = await execute_query(
            """SELECT l.company_name, l.code, l.stage, l.next_followup_at FROM leads l WHERE l.owner_id = %s AND l.next_followup_at IS NOT NULL AND l.next_followup_at <= %s
               AND l.stage IN ('NEW','CONTACTED','QUALIFIED','TENDER','PROPOSAL') ORDER BY l.next_followup_at""", (o["id"], today), fetch_all=True)
        rows = [(l["company_name"] or l["code"], l["stage"].title(), l["next_followup_at"], (now_local.date() - datetime.strptime(l["next_followup_at"], "%Y-%m-%d").date()).days) for l in (leads or [])]
        _send(o["email"], f"Follow-ups due: {len(rows)} lead{'s' if len(rows) != 1 else ''}", _cm_followup_digest_email_html(o["name"], rows))
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
