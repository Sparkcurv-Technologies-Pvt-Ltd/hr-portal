"""The ``/api`` router: includes every domain router plus the root and health endpoints."""

from fastapi import APIRouter

from app.db import execute_query
from app.routers.admin import admin_router
from app.routers.attendance import attendance_router
from app.routers.auth import auth_router
from app.routers.client_portal import client_router
from app.routers.cr import cr_router
from app.routers.employees import employees_router
from app.routers.finance import finance_router
from app.routers.holidays import holidays_router
from app.routers.leave import leave_router
from app.routers.monitoring import monitoring_router
from app.routers.payslip import payslip_router
from app.routers.permission import permission_router
from app.routers.policy import policy_router
from app.routers.projects import projects_router
from app.routers.reports import reports_router
from app.routers.ssh import ssh_router
from app.routers.tickets import tickets_router
from app.routers.vault import vault_router
from app.routers.wfh import wfh_router


# Create routers
api_router = APIRouter(prefix="/api")

api_router.include_router(auth_router)
api_router.include_router(attendance_router)
api_router.include_router(leave_router)
api_router.include_router(admin_router)
api_router.include_router(employees_router)
api_router.include_router(permission_router)
api_router.include_router(payslip_router)
api_router.include_router(reports_router)
api_router.include_router(holidays_router)
api_router.include_router(policy_router)
api_router.include_router(wfh_router)
api_router.include_router(cr_router)
api_router.include_router(finance_router)
api_router.include_router(vault_router)
api_router.include_router(projects_router)
api_router.include_router(tickets_router)
api_router.include_router(monitoring_router)
api_router.include_router(ssh_router)
api_router.include_router(client_router)

@api_router.get("/")
async def root():
    return {"message": "HR Portal API"}

@api_router.get("/health")
async def health_check():
    """Health check endpoint to verify DB connection"""
    try:
        result = await execute_query("SELECT COUNT(*) as cnt FROM users", fetch_one=True)
        return {"status": "ok", "database": "connected", "users_count": result["cnt"] if result else 0}
    except Exception as e:
        return {"status": "error", "database": "disconnected", "error": str(e)}
