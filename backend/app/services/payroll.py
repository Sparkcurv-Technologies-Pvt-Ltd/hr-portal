"""Payroll logic: salary components, bulk payslip generation and the daily scheduler loop."""

import asyncio
import json
from datetime import datetime, timezone

from app.core.config import DEFAULT_SALARY_COMPONENTS, MONTH_NAMES, WORKING_DAYS_PER_MONTH
from app.core.email import _payslip_email_html, _send_email_with_pdf
from app.core.log import logger
from app.db import execute_query
from app.services.payslip_pdf import generate_payslip_pdf


async def send_payslip_email(payslip_id: int) -> str:
    """Email one payslip PDF to its employee and return the address it was sent to.
    Raises LookupError if the payslip doesn't exist, ValueError if the employee has no email."""
    ps_row = await execute_query("SELECT * FROM payslips WHERE id = %s", (payslip_id,), fetch_one=True)
    if not ps_row:
        raise LookupError("Payslip not found")
    ps = dict(ps_row)
    if isinstance(ps.get("deduction_details"), str):
        ps["deduction_details"] = json.loads(ps["deduction_details"])
    emp = await execute_query("SELECT employee_code, email FROM users WHERE id = %s", (ps["employee_id"],), fetch_one=True)
    ps["employee_code"] = emp["employee_code"] if emp else ""
    recipient = ps.get("employee_email") or (emp["email"] if emp else None)
    if not recipient:
        raise ValueError("Employee email not found")
    ps["earnings_breakdown"] = _compute_earnings(ps.get("basic_salary", 0) or 0, await _get_salary_components())
    pdf_buffer = generate_payslip_pdf(ps)
    subject = f"Payslip for {ps['month_name']} {ps['year']} — Sparkcurv HR"
    filename = f"Payslip_{ps['month_name']}_{ps['year']}.pdf"
    await asyncio.get_event_loop().run_in_executor(
        None, lambda: _send_email_with_pdf(recipient, subject, _payslip_email_html(ps), pdf_buffer, filename)
    )
    return recipient

async def _email_payslips(payslip_ids: list) -> None:
    for pid in payslip_ids:
        try:
            recipient = await send_payslip_email(pid)
            logger.info(f"Payslip {pid} emailed to {recipient}")
        except Exception as e:
            logger.warning(f"Payslip {pid} email failed: {e}")

def email_payslips_in_background(payslip_ids: list) -> None:
    """Email newly generated payslips without making the caller wait for SMTP."""
    if payslip_ids:
        asyncio.create_task(_email_payslips(list(payslip_ids)))

async def _get_salary_components() -> list:
    """Fetch salary components from DB, returning defaults if table empty."""
    rows = await execute_query("SELECT * FROM salary_components ORDER BY sort_order", fetch_all=True)
    if rows:
        return [dict(r) for r in rows]
    return DEFAULT_SALARY_COMPONENTS

def _compute_earnings(basic_salary: float, components: list) -> list:
    """Compute earnings breakdown from salary components config."""
    if not basic_salary:
        return []
    result = []
    fixed_total = 0.0
    remainder_component = None
    for comp in components:
        if comp.get("is_remainder"):
            remainder_component = comp
        else:
            amount = round(basic_salary * comp["percentage"] / 100, 2)
            result.append({"name": comp["name"], "amount": amount})
            fixed_total += amount
    if remainder_component:
        remainder_amount = round(basic_salary - fixed_total, 2)
        result.append({"name": remainder_component["name"], "amount": max(remainder_amount, 0)})
    return result


async def _run_bulk_payroll(month: int, year: int, processed_by_name: str) -> dict:
    """Generates payslips for all salaried non-admin employees for the given month/year. Idempotent (skips existing)."""
    employees = await execute_query(
        "SELECT * FROM users WHERE role != 'admin' AND basic_salary > 0", fetch_all=True
    )
    generated_ids = []
    results = {"generated": 0, "skipped": 0, "errors": [], "total_gross": 0, "total_deductions": 0, "total_net": 0}
    if not employees:
        return results

    for employee in employees:
        try:
            existing = await execute_query("SELECT id FROM payslips WHERE employee_id = %s AND month = %s AND year = %s",
                (employee["id"], month, year), fetch_one=True)
            if existing:
                results["skipped"] += 1
                continue

            basic_salary = employee.get("basic_salary", 0) or 0
            deductions = []
            total_deductions = 0
            month_start = datetime(year, month, 1, tzinfo=timezone.utc)
            month_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc)
            per_day_salary = basic_salary / WORKING_DAYS_PER_MONTH
            half_day_salary = per_day_salary / 2

            # Half-day deductions
            leave_deds = await execute_query(
                "SELECT amount FROM leave_deductions WHERE user_id = %s AND date >= %s AND date < %s",
                (employee["id"], month_start.isoformat(), month_end.isoformat()), fetch_all=True
            )
            half_day_amount = sum(d.get("amount", 0) for d in (leave_deds or []))
            if half_day_amount > 0:
                amount = half_day_amount * half_day_salary
                deductions.append({"description": f"Half-day deduction ({half_day_amount} days)", "amount": round(amount, 2)})
                total_deductions += amount

            # LOP deductions
            lop_leaves = await execute_query(
                "SELECT days FROM leave_requests WHERE user_id = %s AND status = 'approved' AND leave_type = 'loss_of_pay' AND start_date >= %s AND start_date < %s",
                (employee["id"], month_start.strftime("%Y-%m-%d"), month_end.strftime("%Y-%m-%d")), fetch_all=True
            )
            lop_days = sum(leave.get("days", 0) for leave in (lop_leaves or []))
            if lop_days > 0:
                lop_amount = lop_days * per_day_salary
                deductions.append({"description": f"Loss of Pay ({lop_days} days)", "amount": round(lop_amount, 2)})
                total_deductions += lop_amount

            # Custom deductions (PF, ESI, TDS, etc.)
            custom_deds = await execute_query(
                "SELECT * FROM custom_deductions WHERE user_id = %s AND is_active = 1",
                (employee["id"],), fetch_all=True
            )
            for cd in (custom_deds or []):
                if cd.get("is_percentage") and cd.get("percentage", 0) > 0:
                    ded_amount = round(basic_salary * cd["percentage"] / 100, 2)
                else:
                    ded_amount = cd.get("amount", 0)
                if ded_amount > 0:
                    deductions.append({"description": cd["deduction_name"], "amount": round(ded_amount, 2)})
                    total_deductions += ded_amount

            net_pay = basic_salary - total_deductions

            new_id = await execute_query(
                """INSERT INTO payslips (employee_id, employee_name, employee_email, department, position, month, year, month_name, basic_salary, deduction_details, total_deductions, net_pay, generated_by, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (employee["id"], employee["name"], employee.get("email", ""), employee.get("department", ""),
                 employee.get("position", ""), month, year, MONTH_NAMES[month],
                 basic_salary, json.dumps(deductions), round(total_deductions, 2), round(net_pay, 2),
                 processed_by_name, datetime.now(timezone.utc).isoformat()),
                last_id=True
            )
            results["generated"] += 1
            generated_ids.append(new_id)
            results["total_gross"] += basic_salary
            results["total_deductions"] += total_deductions
            results["total_net"] += net_pay
        except Exception as e:
            results["errors"].append(f"{employee['name']}: {str(e)}")

    # Save payroll run
    try:
        await execute_query(
            """INSERT INTO payroll_runs (month, year, total_employees, total_gross, total_deductions, total_net, processed_by, processed_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE total_employees=%s, total_gross=%s, total_deductions=%s, total_net=%s, processed_by=%s, processed_at=%s""",
            (month, year, results["generated"], round(results["total_gross"], 2), round(results["total_deductions"], 2), round(results["total_net"], 2), processed_by_name, datetime.now(timezone.utc).isoformat(),
             results["generated"], round(results["total_gross"], 2), round(results["total_deductions"], 2), round(results["total_net"], 2), processed_by_name, datetime.now(timezone.utc).isoformat())
        )
    except Exception:
        pass

    # Email every new payslip to its employee (in the background, so the run returns immediately)
    email_payslips_in_background(generated_ids)
    results["emailed"] = len(generated_ids)
    return results

async def auto_generate_monthly_payslips():
    """Runs daily; generates payslips for the previous completed month for all salaried employees. Safe to re-run (skips existing)."""
    today = datetime.now(timezone.utc)
    if today.month == 1:
        target_month, target_year = 12, today.year - 1
    else:
        target_month, target_year = today.month - 1, today.year
    results = await _run_bulk_payroll(target_month, target_year, "Auto-Generated")
    if results["generated"] > 0:
        logger.info(f"Auto-generated {results['generated']} payslip(s) for {MONTH_NAMES[target_month]} {target_year}")

async def _payslip_scheduler_loop():
    while True:
        try:
            await auto_generate_monthly_payslips()
        except Exception as e:
            logger.warning(f"Auto payslip scheduler error: {e}")
        await asyncio.sleep(24 * 60 * 60)
