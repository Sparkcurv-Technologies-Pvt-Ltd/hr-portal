"""Geofencing: distance calculation, reverse geocoding and office settings lookup."""

import math
from datetime import datetime, timezone

import httpx

from app.core.config import DEFAULT_OFFICE_LAT, DEFAULT_OFFICE_LNG, DEFAULT_OFFICE_RADIUS_KM
from app.db import execute_query


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two GPS points in kilometers."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

async def reverse_geocode(lat, lng):
    """Get address from coordinates using Nominatim (free)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json&addressdetails=1",
                headers={"User-Agent": "SparkCurv-HR-Portal/1.0"}
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("display_name", f"{lat}, {lng}")
    except Exception:
        pass
    return f"{lat}, {lng}"

async def get_office_settings():
    """Get office location settings from DB or use defaults."""
    settings = await execute_query("SELECT * FROM office_settings WHERE id = 1", fetch_one=True)
    if settings:
        return {
            "latitude": float(settings["latitude"]),
            "longitude": float(settings["longitude"]),
            "radius_km": float(settings["radius_km"]),
            "name": settings.get("office_name", "Main Headquarters (Nagercoil)"),
            "address": settings.get("address", "64/3, Thompson St, Palace Rd, Nagercoil, Tamil Nadu 629001"),
            "geofence_bypass": bool(settings.get("geofence_bypass", 0))
        }
    return {
        "latitude": DEFAULT_OFFICE_LAT, "longitude": DEFAULT_OFFICE_LNG,
        "radius_km": DEFAULT_OFFICE_RADIUS_KM,
        "name": "Main Headquarters (Nagercoil)",
        "address": "64/3, Thompson St, Palace Rd, Nagercoil, Tamil Nadu 629001",
        "geofence_bypass": False
    }

async def check_geofence(lat, lng, user_id):
    """Check if location is within office geofence or user has approved WFH."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Check if GPS tracking is disabled for this employee (admin override)
    user_row = await execute_query("SELECT gps_tracking_enabled FROM users WHERE id = %s", (user_id,), fetch_one=True)
    gps_val = user_row.get("gps_tracking_enabled") if user_row else None
    gps_enabled = bool(int(gps_val)) if gps_val is not None else True
    if not gps_enabled:
        return True, "Office"
    # Check if user has approved WFH for today
    wfh = await execute_query(
        "SELECT id FROM wfh_requests WHERE user_id = %s AND date = %s AND status = 'approved'",
        (user_id, today), fetch_one=True
    )
    if wfh:
        return True, "WFH"
    # Check office geofence
    office = await get_office_settings()
    if office.get("geofence_bypass"):
        return True, "Office"
    distance = haversine_km(lat, lng, office["latitude"], office["longitude"])
    if distance <= office["radius_km"]:
        return True, "Office"
    return False, f"Outside office area ({distance:.1f} km away from {office['name']}, max {office['radius_km']} km allowed)"
