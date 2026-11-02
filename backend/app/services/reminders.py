"""Weekday attendance reminder emails.

- Login reminder: Mon–Fri at LOGIN_REMINDER_TIME (office time, APP_TIMEZONE) to everyone who hasn't
  logged in yet — skipping public holidays and people on approved leave that day.
- Logout reminder: as soon as someone still logged in completes their required hours for the day.

Both go to the employee, their reporting manager and REQUEST_NOTIFY_EMAILS, at most once per person per day per kind
(``reminder_log`` has a unique key, so several backend processes can't double-send).
"""

import asyncio
from datetime import datetime, timezone

from app.core.config import APP_TIMEZONE, LOGIN_REMINDER_TIME, REMINDERS_ENABLED, REQUEST_NOTIFY_EMAILS
from app.core.email import _login_reminder_email_html, _logout_reminder_email_html, _send_email
from app.core.log import logger
from app.db import execute_query
from app.services.attendance import get_effective_required_minutes, get_pause_data
from app.services.workdays import is_holiday

CHECK_INTERVAL_SECONDS = 60
LOGIN_REMINDER_WINDOW_HOURS = 3   # still send if the server was down at 10:00, but not hours later


def _reminder_minutes() -> int:
    try:
        h, m = LOGIN_REMINDER_TIME.split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return 10 * 60


async def _claim(user_id: int, date: str, kind: str) -> bool:
    """Record a reminder as sent; False if it was already sent (by this or another process)."""
    inserted = await execute_query(
        "INSERT IGNORE INTO reminder_log (user_id, date, kind, sent_at) VALUES (%s, %s, %s, %s)",
        (user_id, date, kind, datetime.now(timezone.utc).isoformat())
    )
    return inserted == 1


async def _recipients(user: dict) -> list:
    """The employee, their reporting manager and the notification list — each address once."""
    candidates = [user.get("email")]
    if user.get("reporting_manager_id"):
        mgr = await execute_query("SELECT email FROM users WHERE id = %s", (user["reporting_manager_id"],), fetch_one=True)
        candidates.append(mgr.get("email") if mgr else None)
    candidates += REQUEST_NOTIFY_EMAILS
    emails, seen = [], set()
    for e in candidates:
        if e and e.lower() not in seen:
            seen.add(e.lower()); emails.append(e)
    return emails


def _send(recipients: list, subject: str, html_body: str) -> None:
    asyncio.get_event_loop().run_in_executor(None, _send_email, recipients, subject, html_body)


async def send_login_reminders(now_local: datetime) -> int:
    """Mon–Fri, from the reminder time for a few hours: remind everyone who hasn't logged in."""
    minutes = now_local.hour * 60 + now_local.minute
    start = _reminder_minutes()
    if now_local.weekday() >= 5 or not (start <= minutes < start + LOGIN_REMINDER_WINDOW_HOURS * 60):
        return 0
    today = now_local.strftime("%Y-%m-%d")
    if await is_holiday(today):
        return 0
    attendance_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")  # attendance rows are keyed by UTC date
    people = await execute_query(
        """SELECT u.id, u.name, u.email, u.reporting_manager_id FROM users u
           WHERE u.role != 'admin'
             AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.date IN (%s, %s))
             AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.user_id = u.id AND l.status = 'approved'
                             AND l.start_date <= %s AND l.end_date >= %s)
             AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.user_id = u.id AND r.date = %s AND r.kind = 'login')""",
        (today, attendance_date, today, today, today), fetch_all=True
    )
    sent = 0
    for person in (people or []):
        if not person.get("email") or not await _claim(person["id"], today, "login"):
            continue
        html_body = _login_reminder_email_html(person["name"], now_local.strftime("%A, %d %B %Y"), LOGIN_REMINDER_TIME)
        _send(await _recipients(person), f"Login reminder: {person['name']} hasn't logged in yet", html_body)
        sent += 1
    if sent:
        logger.info(f"Login reminders sent: {sent}")
    return sent


async def send_logout_reminders(now_utc: datetime) -> int:
    """Remind anyone still logged in once their required hours for today are complete."""
    open_days = await execute_query(
        """SELECT a.id, a.user_id, a.date, a.clock_in, u.name, u.email, u.reporting_manager_id
           FROM attendance a JOIN users u ON u.id = a.user_id
           WHERE a.clock_out IS NULL AND a.date = %s
             AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.user_id = a.user_id AND r.date = a.date AND r.kind = 'logout')""",
        (now_utc.strftime("%Y-%m-%d"),), fetch_all=True
    )
    sent = 0
    for row in (open_days or []):
        clock_in = datetime.fromisoformat(row["clock_in"])
        if clock_in.tzinfo is None:
            clock_in = clock_in.replace(tzinfo=timezone.utc)
        _, pause_minutes = await get_pause_data(row["id"])
        worked_minutes = (now_utc - clock_in).total_seconds() / 60 - pause_minutes
        required_minutes, _, _ = await get_effective_required_minutes(row["user_id"], row["date"])
        if worked_minutes < required_minutes or not row.get("email"):
            continue
        if not await _claim(row["user_id"], row["date"], "logout"):
            continue
        h, m = divmod(int(worked_minutes), 60)
        html_body = _logout_reminder_email_html(
            row["name"], clock_in.astimezone(APP_TIMEZONE).strftime("%A, %d %B %Y"),
            clock_in.astimezone(APP_TIMEZONE).strftime("%I:%M %p").lstrip("0"), f"{h}h {m}m",
        )
        _send(await _recipients(row), f"Hours complete: {row['name']} can log out", html_body)
        sent += 1
    if sent:
        logger.info(f"Logout reminders sent: {sent}")
    return sent


async def _reminder_loop():
    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            await send_login_reminders(now_utc.astimezone(APP_TIMEZONE))
            await send_logout_reminders(now_utc)
        except Exception as e:
            logger.warning(f"Reminder scheduler error: {e}")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


def start_reminder_scheduler() -> None:
    if REMINDERS_ENABLED:
        asyncio.create_task(_reminder_loop())
        logger.info(f"Attendance reminders started (login reminder Mon–Fri at {LOGIN_REMINDER_TIME}, logout reminder at hours complete)")
