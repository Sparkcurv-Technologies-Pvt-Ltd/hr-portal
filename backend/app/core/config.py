"""Application configuration: environment variables and constants.

``load_dotenv()`` runs at import time, before any ``os.environ`` read below.
"""

import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


load_dotenv()

# Office timezone, used where a local wall-clock time matters (e.g. on-time clock-in)
APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Kolkata"))

# Cookie security - detect HTTPS from FRONTEND_URL
IS_HTTPS = os.environ.get("FRONTEND_URL", "").startswith("https")
COOKIE_SECURE = IS_HTTPS
COOKIE_SAMESITE = "none" if IS_HTTPS else "lax"

# ── Gmail SMTP Email Utility ────────────────────────────────────────────────────
# SMTP_EMAIL / SMTP_PASSWORD take precedence; GMAIL_* names kept for older .env files
GMAIL_USER = os.environ.get("SMTP_EMAIL") or os.environ.get("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.environ.get("SMTP_PASSWORD") or os.environ.get("GMAIL_APP_PASSWORD", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
# Extra fixed emails to always notify (comma-separated in .env)
_extra_emails_raw = os.environ.get("EXTRA_NOTIFICATION_EMAILS", "")
EXTRA_NOTIFICATION_EMAILS = [e.strip() for e in _extra_emails_raw.split(",") if e.strip()]
# Notified on every new leave / permission request (comma-separated override in .env)
_request_emails_raw = os.environ.get(
    "REQUEST_NOTIFY_EMAILS",
    "ponish.jino@sparkcurv.com,Jebin.s@sparkcurv.com,ranjith.m@sparkcurv.com,senthil@sparkcurv.com,arun@sparkcurv.com",
)
REQUEST_NOTIFY_EMAILS = [e.strip() for e in _request_emails_raw.split(",") if e.strip()]
# Weekday attendance reminder emails (to the employee + their reporting manager)
REMINDERS_ENABLED = os.environ.get("REMINDERS_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")
LOGIN_REMINDER_TIME = os.environ.get("LOGIN_REMINDER_TIME", "10:00")   # office time (APP_TIMEZONE), Mon–Fri
# Superadmins: admins with full access, including Reset Portal Data (comma-separated override in .env)
SUPERADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("SUPERADMIN_EMAILS", "ponish.jino@sparkcurv.com").split(",") if e.strip()}

ROOT_DIR = Path(__file__).parent.parent.parent  # backend/ (the directory server.py lives in)

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp"
}

# JWT Config
JWT_ALGORITHM = "HS256"

# Constants
# Login → Logout must span 8 hours (pause time is not counted)
REQUIRED_WORK_HOURS = 8
TOTAL_WORK_HOURS = 8
MONTHLY_PERMISSION_HOURS = 2
MAX_PERMISSION_PER_USE = 1
SHORT_DAYS_FOR_HALF_LEAVE = 3
WORKING_DAYS_PER_MONTH = 22

# Holiday List
# Initial holiday list, copied into the `holidays` table on first start; admins manage holidays in the app after that
DEFAULT_HOLIDAYS = [
    {"date": "2026-01-01", "day": "Thursday", "festival": "New Year"},
    {"date": "2026-01-26", "day": "Monday", "festival": "Republic Day"},
    {"date": "2026-04-03", "day": "Friday", "festival": "Good Friday"},
    {"date": "2026-04-14", "day": "Tuesday", "festival": "Vishu"},
    {"date": "2026-05-01", "day": "Friday", "festival": "May Day"},
    {"date": "2026-05-27", "day": "Wednesday", "festival": "Bakrid (Tentative)"},
    {"date": "2026-08-15", "day": "Saturday", "festival": "Independence Day"},
    {"date": "2026-08-25", "day": "Tuesday", "festival": "Onam"},
    {"date": "2026-10-02", "day": "Friday", "festival": "Gandhi Jayanti"},
    {"date": "2026-10-20", "day": "Tuesday", "festival": "Vijayadasami"},
    {"date": "2026-11-08", "day": "Sunday", "festival": "Diwali"},
    {"date": "2026-12-25", "day": "Friday", "festival": "Christmas"},
]

SHIFTS = {}  # Legacy - no longer used. Shifts are stored as "HH:MM-HH:MM" in users.shift column

DEFAULT_SHIFT_START = "09:00"
DEFAULT_SHIFT_END = "18:00"

# Geofencing defaults (can be overridden in DB settings table)
DEFAULT_OFFICE_LAT = 8.1815   # Sparkcurv HQ, Nagercoil, Tamil Nadu
DEFAULT_OFFICE_LNG = 77.4294
DEFAULT_OFFICE_RADIUS_KM = 0.5  # 500 meters

DEFAULT_SALARY_COMPONENTS = [
    {"name": "Basic", "percentage": 50.0, "is_remainder": 0, "sort_order": 1},
    {"name": "House Rent Allowance", "percentage": 20.0, "is_remainder": 0, "sort_order": 2},
    {"name": "Medical Allowance", "percentage": 4.5, "is_remainder": 0, "sort_order": 3},
    {"name": "Conveyance Allowance", "percentage": 6.0, "is_remainder": 0, "sort_order": 4},
    {"name": "Special Allowance", "percentage": 0.0, "is_remainder": 1, "sort_order": 5},
]

# Bulk Payroll Processing
MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

CR_TYPES = ["Installation", "Maintenance", "Software", "Hardware", "Access", "Policy Change", "Salary Revision", "Leave Adjustment", "Shift Change", "General", "Other"]

# ── Income & Expense (Finance) — Admin only ─────────────────────────────────
FINANCE_DEFAULT_CATEGORIES = [
    ("Salary", "expense"), ("Rent", "expense"), ("Utilities", "expense"),
    ("Office Supplies", "expense"), ("Travel", "expense"), ("Marketing", "expense"),
    ("Software/Subscriptions", "expense"), ("Misc Expense", "expense"),
    ("Sales", "income"), ("Service Revenue", "income"), ("Investment", "income"), ("Misc Income", "income"),
]

# CORS - Allow frontend URL
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
allowed_origins = [frontend_url]
# Also allow without trailing slash
if frontend_url.endswith("/"):
    allowed_origins.append(frontend_url.rstrip("/"))
else:
    allowed_origins.append(frontend_url + "/")
