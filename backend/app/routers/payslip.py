"""Employee payslip routes (``/api/payslip``)."""

import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.security import get_current_user
from app.db import execute_query
from app.services.payroll import _compute_earnings, _get_salary_components
from app.services.payslip_pdf import generate_payslip_pdf


payslip_router = APIRouter(prefix="/payslip")


@payslip_router.get("/my-payslips")
async def get_my_payslips(request: Request):
    user = await get_current_user(request)
    rows = await execute_query("SELECT * FROM payslips WHERE employee_id = %s ORDER BY created_at DESC", (user["id"],), fetch_all=True)
    result = []
    for ps in (rows or []):
        d = dict(ps)
        d["id"] = str(d.pop("id"))
        d["employee_id"] = str(d["employee_id"])
        if isinstance(d.get("deduction_details"), str):
            d["deduction_details"] = json.loads(d["deduction_details"])
        result.append(d)
    return result

@payslip_router.get("/download/{payslip_id}")
async def download_payslip(payslip_id: str, request: Request):
    user = await get_current_user(request)
    payslip = await execute_query("SELECT * FROM payslips WHERE id = %s", (int(payslip_id),), fetch_one=True)
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    if payslip["employee_id"] != user["id"] and user.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")

    ps = dict(payslip)
    if isinstance(ps.get("deduction_details"), str):
        ps["deduction_details"] = json.loads(ps["deduction_details"])
    # Fetch employee_code for the payslip
    emp = await execute_query("SELECT employee_code FROM users WHERE id = %s", (ps["employee_id"],), fetch_one=True)
    ps["employee_code"] = emp["employee_code"] if emp else ""
    # Attach earnings breakdown from salary_components
    ps["earnings_breakdown"] = _compute_earnings(ps.get("basic_salary", 0) or 0, await _get_salary_components())
    pdf_buffer = generate_payslip_pdf(ps)
    return StreamingResponse(pdf_buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=payslip_{ps['month']}_{ps['year']}.pdf"})


# Employee salary structure view
@payslip_router.get("/my-salary-structure")
async def get_my_salary_structure(request: Request):
    user = await get_current_user(request)
    basic_salary = user.get("basic_salary", 0) or 0
    components = await _get_salary_components()
    earnings = _compute_earnings(basic_salary, components)
    earnings_out = []
    for e in earnings:
        # Find matching component percentage for display
        comp_match = next((c for c in components if c["name"] == e["name"]), None)
        pct = comp_match["percentage"] if comp_match and not comp_match.get("is_remainder") else None
        entry = {"name": e["name"], "amount": e["amount"]}
        if pct:
            entry["percentage"] = pct
        earnings_out.append(entry)

    # Get custom deductions
    custom_deds = await execute_query(
        "SELECT * FROM custom_deductions WHERE user_id = %s AND is_active = 1",
        (user["id"],), fetch_all=True
    )
    deductions = []
    total_deductions = 0
    for cd in (custom_deds or []):
        if cd.get("is_percentage") and cd.get("percentage", 0) > 0:
            ded_amount = round(basic_salary * cd["percentage"] / 100, 2)
        else:
            ded_amount = cd.get("amount", 0)
        deductions.append({"name": cd["deduction_name"], "amount": round(ded_amount, 2), "is_percentage": bool(cd.get("is_percentage", 0)), "percentage": cd.get("percentage", 0)})
        total_deductions += ded_amount

    return {
        "gross_salary": basic_salary,
        "earnings": earnings_out,
        "deductions": deductions,
        "total_deductions": round(total_deductions, 2),
        "net_salary": round(basic_salary - total_deductions, 2)
    }
