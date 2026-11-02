"""Report export routes (``/api/reports``)."""

import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from app.core.permissions import require_permission
from app.db import execute_query


reports_router = APIRouter(prefix="/reports")


@reports_router.get("/attendance/export")
async def export_attendance_report(request: Request, start_date: str, end_date: str, employee_id: Optional[str] = None):
    await require_permission(request, "attendance", "view")
    query = "SELECT * FROM attendance WHERE date >= %s AND date <= %s"
    args = [start_date, end_date]
    if employee_id:
        query += " AND user_id = %s"
        args.append(int(employee_id))
    query += " ORDER BY date ASC, user_name ASC"
    records = await execute_query(query, tuple(args), fetch_all=True)

    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance Report"
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="002FA7", end_color="002FA7", fill_type="solid")
    thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))

    headers = ["Employee Name", "Date", "Clock In", "Clock Out", "Working Hours", "Break Time (min)", "Short Day", "Total Hours"]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    total_hours_all = 0
    for row_num, record in enumerate(records or [], 2):
        clock_in = datetime.fromisoformat(record["clock_in"]).strftime("%I:%M %p") if record.get("clock_in") else "-"
        clock_out = datetime.fromisoformat(record["clock_out"]).strftime("%I:%M %p") if record.get("clock_out") else "-"
        wh = record.get("working_hours", 0) or 0
        total_hours_all += wh
        row_data = [record.get("user_name", ""), record.get("date", ""), clock_in, clock_out, f"{wh:.2f}" if wh else "-", record.get("total_break_minutes", 0), "Yes" if record.get("is_short_day") else "No", f"{wh:.2f}" if wh else "-"]
        for col, value in enumerate(row_data, 1):
            cell = ws.cell(row=row_num, column=col, value=value)
            cell.border = thin_border

    for w, c in [('A', 20), ('B', 12), ('C', 12), ('D', 12), ('E', 15), ('F', 15), ('G', 12), ('H', 12)]:
        ws.column_dimensions[w].width = c

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename=attendance_{start_date}_to_{end_date}.xlsx"})
