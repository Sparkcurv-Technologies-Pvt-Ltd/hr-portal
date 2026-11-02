"""Routes that were registered directly on the app with full ``/api/...`` paths.

They use a prefix-less router that main.py includes before ``api_router`` so the
route registration order is unchanged.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app.core.security import get_current_user, require_admin_or_manager
from app.db import execute_query


app_router = APIRouter()

# ── Org Levels (custom label per depth level) ─────────────────────────────────
@app_router.get("/api/org-levels")
async def get_org_levels(request: Request):
    await get_current_user(request)
    rows = await execute_query("SELECT level_num, label FROM org_levels ORDER BY level_num ASC", fetch_all=True)
    return rows or []


# All roles can read their own permissions
@app_router.get("/api/my-permissions")
async def get_my_permissions(request: Request):
    user = await get_current_user(request)
    role = user.get("role", "employee")
    if role == "admin":
        return {"role": "admin", "permissions": {}}  # admin has all access
    rows = await execute_query(
        "SELECT feature_key, enabled FROM role_permissions WHERE role=%s",
        (role,), fetch_all=True
    )
    perms = {}
    for r in (rows or []):
        perms[r["feature_key"]] = bool(r["enabled"])
    return {"role": role, "permissions": perms}


@app_router.get("/api/birthdays/list")
async def get_birthdays_list(request: Request):
    await get_current_user(request)
    rows = await execute_query(
        "SELECT id, name, department, avatar_url, employee_code, date_of_birth FROM users WHERE date_of_birth IS NOT NULL AND date_of_birth != ''",
        fetch_all=True
    )
    today = datetime.now(timezone.utc).date()
    result = []
    for r in (rows or []):
        try:
            dob = datetime.strptime(r["date_of_birth"], "%Y-%m-%d").date()
            next_bday = dob.replace(year=today.year)
        except (ValueError, TypeError):
            continue
        if next_bday < today:
            try:
                next_bday = dob.replace(year=today.year + 1)
            except ValueError:
                next_bday = next_bday.replace(day=28, year=today.year + 1)
        days_until = (next_bday - today).days
        result.append({
            "id": str(r["id"]),
            "name": r["name"],
            "department": r["department"],
            "avatar_url": r["avatar_url"],
            "employee_code": r["employee_code"],
            "date_of_birth": r["date_of_birth"],
            "month": dob.month,
            "day": dob.day,
            "days_until": days_until
        })
    result.sort(key=lambda x: x["days_until"])
    return result

@app_router.get("/api/team/members")
async def get_team_members(request: Request):
    """Returns the current manager's direct reports (for the Manager 'My Team' tab)."""
    user = await require_admin_or_manager(request)
    if user["role"] == "admin":
        return []
    rows = await execute_query(
        "SELECT id, name, email, department, position, avatar_url, employee_code, role FROM users WHERE reporting_manager_id = %s ORDER BY name",
        (user["id"],), fetch_all=True
    )
    return [{"id": str(r["id"]), "name": r["name"], "email": r["email"], "department": r["department"], "position": r["position"], "avatar_url": r["avatar_url"], "employee_code": r["employee_code"], "role": r["role"]} for r in (rows or [])]

@app_router.get("/api/team-events")
async def get_team_events(request: Request):
    """Combined widget feed for dashboard overviews: upcoming birthdays, work anniversaries & new joiners."""
    await get_current_user(request)
    rows = await execute_query(
        "SELECT id, name, department, avatar_url, employee_code, date_of_birth, created_at FROM users",
        fetch_all=True
    )
    today = datetime.now(timezone.utc).date()
    birthdays, anniversaries, new_joiners = [], [], []
    for r in (rows or []):
        base = {"id": str(r["id"]), "name": r["name"], "department": r["department"], "avatar_url": r["avatar_url"], "employee_code": r["employee_code"]}

        if r.get("date_of_birth"):
            try:
                dob = datetime.strptime(r["date_of_birth"], "%Y-%m-%d").date()
                next_bday = dob.replace(year=today.year)
                if next_bday < today:
                    next_bday = dob.replace(year=today.year + 1)
                days_until = (next_bday - today).days
                if days_until <= 30:
                    birthdays.append({**base, "days_until": days_until})
            except (ValueError, TypeError):
                pass

        if r.get("created_at"):
            try:
                joined = datetime.fromisoformat(str(r["created_at"])).date()
                days_since_join = (today - joined).days
                if 0 <= days_since_join <= 30:
                    new_joiners.append({**base, "joined_date": joined.isoformat(), "days_since_join": days_since_join})

                next_anniv = joined.replace(year=today.year)
                if next_anniv < today:
                    next_anniv = joined.replace(year=today.year + 1)
                years = next_anniv.year - joined.year
                days_until = (next_anniv - today).days
                if years >= 1 and days_until <= 30:
                    anniversaries.append({**base, "years": years, "days_until": days_until})
            except (ValueError, TypeError):
                pass

    birthdays.sort(key=lambda x: x["days_until"])
    anniversaries.sort(key=lambda x: x["days_until"])
    new_joiners.sort(key=lambda x: x["days_since_join"])
    return {"birthdays": birthdays, "anniversaries": anniversaries, "new_joiners": new_joiners}
