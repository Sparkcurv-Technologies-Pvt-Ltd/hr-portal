"""Attendance routes (``/api/attendance``): login/logout, pauses, timer."""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.config import REQUIRED_WORK_HOURS, SHORT_DAYS_FOR_HALF_LEAVE, TOTAL_WORK_HOURS
from app.core.email import _emergency_clockout_email_html, _send_email
from app.core.log import logger
from app.core.security import get_current_user
from app.db import execute_query
from app.services.attendance import check_and_deduct_half_day_leave, get_effective_required_minutes, get_pause_data
from app.services.geofence import check_geofence, get_office_settings, haversine_km, reverse_geocode
from app.services.workdays import get_holiday_name, is_holiday, is_weekend, parse_shift


attendance_router = APIRouter(prefix="/attendance")


@attendance_router.post("/clock-in")
async def clock_in(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if is_weekend(today):
        raise HTTPException(status_code=400, detail="Cannot log in on weekends (Saturday/Sunday)")
    if await is_holiday(today):
        raise HTTPException(status_code=400, detail=f"Cannot log in on holiday: {await get_holiday_name(today)}")

    # Parse location from request body
    try:
        body = await request.json()
        lat = body.get("latitude")
        lng = body.get("longitude")
    except Exception:
        lat = None
        lng = None

    # Check if user has approved WFH today — GPS becomes optional
    wfh_today = await execute_query(
        "SELECT id FROM wfh_requests WHERE user_id = %s AND date = %s AND status = 'approved'",
        (user["id"], today), fetch_one=True
    )
    is_wfh = bool(wfh_today)

    if lat is None or lng is None:
        if not is_wfh:
            # Check if GPS tracking is disabled for this employee
            user_gps_row = await execute_query("SELECT gps_tracking_enabled FROM users WHERE id = %s", (user["id"],), fetch_one=True)
            gps_val = user_gps_row.get("gps_tracking_enabled") if user_gps_row else None
            gps_enabled = bool(int(gps_val)) if gps_val is not None else True
            if gps_enabled:
                raise HTTPException(status_code=400, detail="Location is required. Please enable GPS/location services.")
        # WFH or GPS-disabled employee — clock in without GPS
        lat = 0.0
        lng = 0.0

    # Geofence check (will auto-pass for WFH employees)
    allowed, location_type = await check_geofence(lat, lng, user["id"])
    if not allowed:
        raise HTTPException(status_code=400, detail=f"Cannot log in: {location_type}. You must be at the office or have approved WFH.")

    existing = await execute_query(
        "SELECT id, clock_out FROM attendance WHERE user_id = %s AND date = %s ORDER BY id DESC LIMIT 1", (user["id"], today), fetch_one=True
    )
    # One Login and one Logout per day
    if existing and existing["clock_out"] is None:
        raise HTTPException(status_code=400, detail="Already logged in")
    if existing:
        raise HTTPException(status_code=400, detail="You've already logged in and out today. You can log in again tomorrow.")

    # Reverse geocode (skip for WFH with no location)
    address = await reverse_geocode(lat, lng) if (lat != 0.0 or lng != 0.0) else "Work From Home"

    att_id = await execute_query(
        "INSERT INTO attendance (user_id, user_name, date, clock_in, total_break_minutes, clock_in_lat, clock_in_lng, clock_in_address, location_type) VALUES (%s, %s, %s, %s, 0, %s, %s, %s, %s)",
        (user["id"], user["name"], today, datetime.now(timezone.utc).isoformat(), lat, lng, address, location_type), last_id=True
    )

    return {"id": str(att_id), "user_id": str(user["id"]), "user_name": user["name"], "date": today, "clock_in": datetime.now(timezone.utc).isoformat(), "clock_out": None, "breaks": [], "total_break_minutes": 0, "clock_in_lat": lat, "clock_in_lng": lng, "clock_in_address": address, "location_type": location_type}

@attendance_router.post("/clock-out")
async def clock_out(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Parse location from request body
    try:
        body = await request.json()
        lat = body.get("latitude")
        lng = body.get("longitude")
        emergency_reason = (body.get("emergency_reason") or "").strip()
    except Exception:
        lat = None
        lng = None
        emergency_reason = ""

    # Allow clock-out without GPS if user has approved WFH today
    wfh_today = await execute_query(
        "SELECT id FROM wfh_requests WHERE user_id = %s AND date = %s AND status = 'approved'",
        (user["id"], today), fetch_one=True
    )
    is_wfh = bool(wfh_today)

    if lat is None or lng is None:
        if not is_wfh:
            # Check GPS tracking setting for this employee
            user_gps_row = await execute_query("SELECT gps_tracking_enabled FROM users WHERE id = %s", (user["id"],), fetch_one=True)
            gps_val = user_gps_row.get("gps_tracking_enabled") if user_gps_row else None
            gps_enabled = bool(int(gps_val)) if gps_val is not None else True
            if gps_enabled:
                raise HTTPException(status_code=400, detail="Location is required for logout.")
        lat = 0.0
        lng = 0.0

    attendance = await execute_query(
        "SELECT * FROM attendance WHERE user_id = %s AND date = %s AND clock_out IS NULL", (user["id"], today), fetch_one=True
    )
    if not attendance:
        raise HTTPException(status_code=400, detail="Not logged in")

    clock_out_time = datetime.now(timezone.utc)

    # Reverse geocode (skip for WFH with no location)
    address = await reverse_geocode(lat, lng) if (lat != 0.0 or lng != 0.0) else "Work From Home"

    # Close a break left open from before the break feature was removed
    active_break = await execute_query(
        "SELECT id, break_start FROM breaks WHERE attendance_id = %s AND break_end IS NULL", (attendance["id"],), fetch_one=True
    )
    if active_break:
        await execute_query("UPDATE breaks SET break_end = %s WHERE id = %s", (clock_out_time.isoformat(), active_break["id"]))

    # End any active pause
    active_pause = await execute_query(
        "SELECT id FROM pauses WHERE attendance_id = %s AND pause_end IS NULL", (attendance["id"],), fetch_one=True
    )
    if active_pause:
        await execute_query("UPDATE pauses SET pause_end = %s WHERE id = %s", (clock_out_time.isoformat(), active_pause["id"]))

    # Calculate total break minutes
    breaks_list = await execute_query(
        "SELECT break_start, break_end FROM breaks WHERE attendance_id = %s", (attendance["id"],), fetch_all=True
    )
    total_break = 0
    for brk in (breaks_list or []):
        if brk["break_start"] and brk["break_end"]:
            s = datetime.fromisoformat(brk["break_start"])
            e = datetime.fromisoformat(brk["break_end"])
            total_break += (e - s).total_seconds() / 60

    _, total_pause = await get_pause_data(attendance["id"])
    required_minutes, permission_minutes_today, is_half_day_today = await get_effective_required_minutes(user["id"], today)

    clock_in_time = datetime.fromisoformat(attendance["clock_in"])
    total_time_minutes = (clock_out_time - clock_in_time).total_seconds() / 60
    # The day is Login → Logout; only pause (travel/away) time is deducted
    working_minutes = total_time_minutes - total_pause
    working_hours = working_minutes / 60
    is_short_day = 1 if working_minutes < required_minutes else 0
    is_emergency = bool(emergency_reason) and working_minutes < required_minutes

    full_day_required = user.get("full_day_required") is None or bool(int(user["full_day_required"]))
    if working_minutes < required_minutes and not emergency_reason and full_day_required:
        shortfall_minutes = round(required_minutes - working_minutes)
        shortfall_h, shortfall_m = divmod(max(0, shortfall_minutes), 60)
        required_h, required_m = divmod(required_minutes, 60)
        reasons = []
        if is_half_day_today:
            reasons.append("approved half-day leave")
        if permission_minutes_today:
            reasons.append(f"{round(permission_minutes_today)}min approved permission")
        reduction_note = f" (required workday reduced to {required_h}h {required_m}m due to {' + '.join(reasons)})" if reasons else ""
        raise HTTPException(status_code=400, detail=f"Cannot log out yet — {shortfall_h}h {shortfall_m}m more needed to complete the required {REQUIRED_WORK_HOURS}h day (Login to Logout, pauses excluded){reduction_note}. If this is an emergency, use Emergency Logout instead.")

    await execute_query(
        "UPDATE attendance SET clock_out = %s, total_break_minutes = %s, working_hours = %s, is_short_day = %s, is_emergency_clockout = %s, emergency_reason = %s, clock_out_lat = %s, clock_out_lng = %s, clock_out_address = %s WHERE id = %s",
        (clock_out_time.isoformat(), int(total_break), round(working_hours, 2), is_short_day, 1 if is_emergency else 0, emergency_reason if is_emergency else None, lat, lng, address, attendance["id"])
    )

    if is_short_day and not is_emergency:
        await check_and_deduct_half_day_leave(user["id"])

    if is_emergency and user.get("reporting_manager_id"):
        try:
            mgr = await execute_query("SELECT id, name, email FROM users WHERE id = %s", (user["reporting_manager_id"],), fetch_one=True)
            if mgr and mgr.get("email"):
                html = _emergency_clockout_email_html(user["name"], emergency_reason, round(working_hours, 2), today)
                asyncio.get_event_loop().run_in_executor(None, _send_email, [mgr["email"]], f"Emergency Logout: {user['name']}", html)
        except Exception as e:
            logger.warning(f"Emergency clock-out email dispatch failed: {e}")

    breaks_formatted = [{"start": b["break_start"], "end": b["break_end"]} for b in (breaks_list or [])]
    return {"id": str(attendance["id"]), "user_id": str(user["id"]), "user_name": user["name"], "date": today, "clock_in": attendance["clock_in"], "clock_out": clock_out_time.isoformat(), "breaks": breaks_formatted, "total_break_minutes": int(total_break), "total_pause_minutes": int(total_pause), "permission_minutes_today": int(permission_minutes_today), "is_half_day_today": is_half_day_today, "working_hours": round(working_hours, 2), "is_short_day": bool(is_short_day), "is_emergency_clockout": is_emergency, "emergency_reason": emergency_reason if is_emergency else None, "clock_out_lat": lat, "clock_out_lng": lng, "clock_out_address": address}


@attendance_router.post("/pause/start")
async def start_pause(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    attendance = await execute_query(
        "SELECT * FROM attendance WHERE user_id = %s AND date = %s AND clock_out IS NULL", (user["id"], today), fetch_one=True
    )
    if not attendance:
        raise HTTPException(status_code=400, detail="Not logged in")


    active_pause = await execute_query(
        "SELECT id FROM pauses WHERE attendance_id = %s AND pause_end IS NULL", (attendance["id"],), fetch_one=True
    )
    if active_pause:
        raise HTTPException(status_code=400, detail="Already paused")

    await execute_query(
        "INSERT INTO pauses (attendance_id, pause_start) VALUES (%s, %s)",
        (attendance["id"], datetime.now(timezone.utc).isoformat())
    )

    pauses_formatted, _ = await get_pause_data(attendance["id"])
    return {"message": "Paused", "pauses": pauses_formatted}

@attendance_router.post("/pause/end")
async def end_pause(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    attendance = await execute_query(
        "SELECT * FROM attendance WHERE user_id = %s AND date = %s AND clock_out IS NULL", (user["id"], today), fetch_one=True
    )
    if not attendance:
        raise HTTPException(status_code=400, detail="Not logged in")

    active_pause = await execute_query(
        "SELECT id FROM pauses WHERE attendance_id = %s AND pause_end IS NULL", (attendance["id"],), fetch_one=True
    )
    if not active_pause:
        raise HTTPException(status_code=400, detail="Not paused")

    await execute_query("UPDATE pauses SET pause_end = %s WHERE id = %s", (datetime.now(timezone.utc).isoformat(), active_pause["id"]))

    pauses_formatted, total_pause = await get_pause_data(attendance["id"])
    return {"message": "Resumed", "pauses": pauses_formatted, "total_pause_minutes": int(total_pause)}

@attendance_router.get("/status")
async def get_attendance_status(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    attendance = await execute_query(
        "SELECT * FROM attendance WHERE user_id = %s AND date = %s ORDER BY id DESC LIMIT 1",
        (user["id"], today), fetch_one=True
    )

    # Check if user has approved WFH today
    wfh_today = await execute_query(
        "SELECT id FROM wfh_requests WHERE user_id = %s AND date = %s AND status = 'approved'",
        (user["id"], today), fetch_one=True
    )
    has_wfh_today = bool(wfh_today)

    if not attendance:
        required_minutes, permission_minutes_today, is_half_day_today = await get_effective_required_minutes(user["id"], today)
        effective_required_hours = round(required_minutes / 60, 2)
        return {"clocked_in": False, "on_pause": False, "attendance": None, "has_wfh_today": has_wfh_today, "required_work_hours": REQUIRED_WORK_HOURS, "permission_minutes_today": int(permission_minutes_today), "is_half_day_today": is_half_day_today, "effective_required_hours": effective_required_hours, "full_day_required": user.get("full_day_required") is None or bool(int(user["full_day_required"]))}

    breaks_list = await execute_query("SELECT break_start, break_end FROM breaks WHERE attendance_id = %s", (attendance["id"],), fetch_all=True)
    breaks_formatted = [{"start": b["break_start"], "end": b["break_end"]} for b in (breaks_list or [])]
    pauses_formatted, total_pause = await get_pause_data(attendance["id"])
    required_minutes, permission_minutes_today, is_half_day_today = await get_effective_required_minutes(user["id"], today)
    effective_required_hours = round(required_minutes / 60, 2)

    on_pause = any(p["end"] is None for p in pauses_formatted)
    total_break_used = attendance.get("total_break_minutes", 0) or 0

    att_data = {
        "user_id": str(attendance["user_id"]),
        "user_name": attendance["user_name"],
        "date": attendance["date"],
        "clock_in": attendance["clock_in"],
        "clock_out": attendance["clock_out"],
        "breaks": breaks_formatted,
        "pauses": pauses_formatted,
        "total_break_minutes": total_break_used,
        "total_pause_minutes": int(total_pause),
        "working_hours": attendance.get("working_hours"),
        "is_short_day": bool(attendance.get("is_short_day"))
    }

    return {"clocked_in": attendance.get("clock_out") is None, "on_pause": on_pause, "attendance": att_data, "has_wfh_today": has_wfh_today, "required_work_hours": REQUIRED_WORK_HOURS, "permission_minutes_today": int(permission_minutes_today), "is_half_day_today": is_half_day_today, "effective_required_hours": effective_required_hours, "full_day_required": user.get("full_day_required") is None or bool(int(user["full_day_required"]))}

@attendance_router.get("/history")
async def get_attendance_history(request: Request, limit: int = 30):
    user = await get_current_user(request)
    records = await execute_query(
        "SELECT * FROM attendance WHERE user_id = %s ORDER BY date DESC LIMIT %s",
        (user["id"], limit), fetch_all=True
    )

    result = []
    for rec in (records or []):
        breaks_list = await execute_query("SELECT break_start, break_end FROM breaks WHERE attendance_id = %s", (rec["id"],), fetch_all=True)
        pauses_formatted, total_pause = await get_pause_data(rec["id"])
        result.append({
            "user_id": str(rec["user_id"]),
            "user_name": rec["user_name"],
            "date": rec["date"],
            "clock_in": rec["clock_in"],
            "clock_out": rec["clock_out"],
            "breaks": [{"start": b["break_start"], "end": b["break_end"]} for b in (breaks_list or [])],
            "pauses": pauses_formatted,
            "total_break_minutes": rec.get("total_break_minutes", 0),
            "total_pause_minutes": int(total_pause),
            "working_hours": rec.get("working_hours"),
            "is_short_day": bool(rec.get("is_short_day"))
        })
    return result

@attendance_router.get("/working-hours-summary")
async def get_working_hours_summary(request: Request):
    user = await get_current_user(request)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1).strftime("%Y-%m-%d")

    records = await execute_query(
        "SELECT working_hours, is_short_day FROM attendance WHERE user_id = %s AND date >= %s AND clock_out IS NOT NULL",
        (user["id"], month_start), fetch_all=True
    )

    total_working_hours = sum(r.get("working_hours", 0) or 0 for r in (records or []))
    short_days = sum(1 for r in (records or []) if r.get("is_short_day"))
    count = len(records or [])

    deductions = await execute_query(
        "SELECT amount FROM leave_deductions WHERE user_id = %s AND date >= %s",
        (user["id"], now.replace(day=1).isoformat()), fetch_all=True
    )
    total_deducted = sum(d.get("amount", 0) for d in (deductions or []))

    return {
        "total_working_days": count,
        "total_working_hours": round(total_working_hours, 2),
        "average_hours_per_day": round(total_working_hours / count, 2) if count else 0,
        "short_days_count": short_days,
        "half_days_deducted": total_deducted,
        "required_hours_per_day": REQUIRED_WORK_HOURS,
        "total_hours_per_day": TOTAL_WORK_HOURS,
        "short_days_for_half_leave": SHORT_DAYS_FOR_HALF_LEAVE
    }

@attendance_router.get("/my-shift")
async def get_my_shift(request: Request):
    user = await get_current_user(request)
    shift_str = user.get("shift") or ""
    info = parse_shift(shift_str)
    return {
        "shift": shift_str,
        "name": f"{info['start']} – {info['end']}",
        "start_time": info["start"],
        "end_time": info["end"],
        "is_set": bool(shift_str)
    }

@attendance_router.post("/check-location")
async def check_location(request: Request):
    """Pre-check if employee's current GPS location is within geofence."""
    user = await get_current_user(request)
    try:
        body = await request.json()
        lat = body.get("latitude")
        lng = body.get("longitude")
    except Exception:
        raise HTTPException(status_code=400, detail="latitude and longitude required")
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="latitude and longitude required")
    office = await get_office_settings()
    distance = haversine_km(lat, lng, office["latitude"], office["longitude"])
    within = office.get("geofence_bypass") or distance <= office["radius_km"]
    # Also check WFH
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    wfh = await execute_query(
        "SELECT id FROM wfh_requests WHERE user_id = %s AND date = %s AND status = 'approved'",
        (user["id"], today), fetch_one=True
    )
    return {
        "your_lat": lat,
        "your_lng": lng,
        "office_lat": office["latitude"],
        "office_lng": office["longitude"],
        "office_name": office["name"],
        "distance_km": round(distance, 2),
        "radius_km": office["radius_km"],
        "within_geofence": within,
        "geofence_bypass": office.get("geofence_bypass", False),
        "has_wfh_today": bool(wfh)
    }


@attendance_router.post("/timer/start")
async def timer_start(request: Request):
    """Start a flexible work timer session for the employee."""
    user = await get_current_user(request)
    # Check access
    timer_row = await execute_query("SELECT timer_access_enabled FROM users WHERE id = %s", (user["id"],), fetch_one=True)
    timer_val = timer_row.get("timer_access_enabled") if timer_row else None
    if not (bool(int(timer_val)) if timer_val is not None else False):
        raise HTTPException(status_code=403, detail="Timer access not enabled by admin")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Check no running session
    running = await execute_query(
        "SELECT id FROM time_tracker_sessions WHERE user_id = %s AND date = %s AND stopped_at IS NULL",
        (user["id"], today), fetch_one=True
    )
    if running:
        raise HTTPException(status_code=400, detail="Timer already running. Stop it before starting again.")
    now_str = datetime.now(timezone.utc).isoformat()
    sid = await execute_query(
        "INSERT INTO time_tracker_sessions (user_id, user_name, date, started_at) VALUES (%s, %s, %s, %s)",
        (user["id"], user["name"], today, now_str), last_id=True
    )
    return {"message": "Timer started", "session_id": sid, "started_at": now_str}

@attendance_router.post("/timer/stop")
async def timer_stop(request: Request):
    """Stop the current running flexible work timer session."""
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    running = await execute_query(
        "SELECT id, started_at FROM time_tracker_sessions WHERE user_id = %s AND date = %s AND stopped_at IS NULL ORDER BY id DESC LIMIT 1",
        (user["id"], today), fetch_one=True
    )
    if not running:
        raise HTTPException(status_code=400, detail="No running timer session found.")
    now_dt = datetime.now(timezone.utc)
    now_str = now_dt.isoformat()
    # Calculate duration
    try:
        from dateutil import parser as dtparser
        start_dt = dtparser.parse(running["started_at"])
        duration_sec = int((now_dt - start_dt).total_seconds())
    except Exception:
        duration_sec = 0
    await execute_query(
        "UPDATE time_tracker_sessions SET stopped_at = %s, duration_seconds = %s WHERE id = %s",
        (now_str, duration_sec, running["id"])
    )
    return {"message": "Timer stopped", "duration_seconds": duration_sec}

@attendance_router.get("/timer/today")
async def timer_today(request: Request):
    """Get today's timer sessions and total tracked time."""
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sessions = await execute_query(
        "SELECT id, started_at, stopped_at, duration_seconds FROM time_tracker_sessions WHERE user_id = %s AND date = %s ORDER BY id ASC",
        (user["id"], today), fetch_all=True
    )
    sessions = [dict(s) for s in (sessions or [])]
    total_seconds = sum(s.get("duration_seconds", 0) or 0 for s in sessions if s.get("stopped_at"))
    running = next((s for s in sessions if not s.get("stopped_at")), None)
    # Calculate live seconds for running session
    live_seconds = 0
    if running:
        try:
            from dateutil import parser as dtparser
            start_dt = dtparser.parse(running["started_at"])
            live_seconds = int((datetime.now(timezone.utc) - start_dt).total_seconds())
        except Exception:
            live_seconds = 0
    return {
        "is_running": bool(running),
        "current_session_started_at": running["started_at"] if running else None,
        "live_seconds": live_seconds,
        "total_seconds": total_seconds,
        "sessions": sessions,
        "target_seconds": 8 * 3600
    }
