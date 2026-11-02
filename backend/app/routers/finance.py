"""Income & expense routes (``/api/finance``), admin only."""

import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from app.core.permissions import require_permission
from app.db import execute_query
from app.schemas.finance import FinanceCategoryCreate
from app.services.media import _get_image_db, _save_receipt_db


finance_router = APIRouter(prefix="/finance")


@finance_router.get("/categories")
async def get_finance_categories(request: Request):
    await require_permission(request, "finance", "view")
    rows = await execute_query("SELECT id, name, type FROM finance_categories ORDER BY type, name", fetch_all=True)
    return [{"id": r["id"], "name": r["name"], "type": r["type"]} for r in (rows or [])]


@finance_router.post("/categories")
async def add_finance_category(data: FinanceCategoryCreate, request: Request):
    await require_permission(request, "finance", "edit")
    if data.type not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="Type must be income or expense")
    existing = await execute_query("SELECT id FROM finance_categories WHERE name = %s", (data.name.strip(),), fetch_one=True)
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")
    cat_id = await execute_query(
        "INSERT INTO finance_categories (name, type) VALUES (%s, %s)",
        (data.name.strip(), data.type), last_id=True
    )
    return {"id": cat_id, "name": data.name.strip(), "type": data.type}

@finance_router.get("/summary")
async def get_finance_summary(request: Request, month: Optional[str] = None):
    await require_permission(request, "finance", "view")
    query = "SELECT type, SUM(amount) as total FROM finance_entries"
    params = []
    if month:
        query += " WHERE entry_date LIKE %s"
        params.append(f"{month}%")
    query += " GROUP BY type"
    rows = await execute_query(query, tuple(params), fetch_all=True)
    total_income = 0.0
    total_expense = 0.0
    for r in (rows or []):
        if r["type"] == "income":
            total_income = float(r["total"] or 0)
        elif r["type"] == "expense":
            total_expense = float(r["total"] or 0)
    return {"total_income": total_income, "total_expense": total_expense, "net_balance": total_income - total_expense}

@finance_router.get("/entries")
async def get_finance_entries(request: Request, month: Optional[str] = None, type: Optional[str] = None):
    await require_permission(request, "finance", "view")
    query = "SELECT * FROM finance_entries WHERE 1=1"
    params = []
    if month:
        query += " AND entry_date LIKE %s"
        params.append(f"{month}%")
    if type in ("income", "expense"):
        query += " AND type = %s"
        params.append(type)
    query += " ORDER BY entry_date DESC, id DESC"
    rows = await execute_query(query, tuple(params), fetch_all=True)
    result = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d["id"])
        d["amount"] = float(d["amount"])
        d["receipt_url"] = f"/api/finance/receipts/{d['receipt_media_id']}" if d.get("receipt_media_id") else None
        result.append(d)
    return result

@finance_router.post("/entries")
async def create_finance_entry(
    request: Request,
    entry_date: str = Form(...),
    type: str = Form(...),
    category: str = Form(...),
    amount: float = Form(...),
    description: str = Form(""),
    receipt: Optional[UploadFile] = File(None)
):
    user = await require_permission(request, "finance", "edit")
    if type not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="Type must be income or expense")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    receipt_media_id = None
    if receipt is not None and receipt.filename:
        allowed_types = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
        if receipt.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP or PDF receipts allowed")
        contents = await receipt.read()
        if len(contents) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Receipt file must be under 8MB")
        receipt_media_id = await _save_receipt_db(contents, receipt.filename, receipt.content_type)

    now = datetime.now(timezone.utc).isoformat()
    entry_id = await execute_query(
        """INSERT INTO finance_entries (entry_date, type, category, amount, description, receipt_media_id, created_by, created_by_name, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (entry_date, type, category, amount, description, receipt_media_id, user["id"], user["name"], now, now),
        last_id=True
    )
    return {"id": str(entry_id), "message": "Entry added"}

@finance_router.put("/entries/{entry_id}")
async def update_finance_entry(
    entry_id: str,
    request: Request,
    entry_date: str = Form(...),
    type: str = Form(...),
    category: str = Form(...),
    amount: float = Form(...),
    description: str = Form(""),
    receipt: Optional[UploadFile] = File(None)
):
    await require_permission(request, "finance", "edit")
    existing = await execute_query("SELECT * FROM finance_entries WHERE id = %s", (int(entry_id),), fetch_one=True)
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")
    if type not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="Type must be income or expense")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    receipt_media_id = existing.get("receipt_media_id")
    if receipt is not None and receipt.filename:
        allowed_types = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
        if receipt.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP or PDF receipts allowed")
        contents = await receipt.read()
        if len(contents) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Receipt file must be under 8MB")
        receipt_media_id = await _save_receipt_db(contents, receipt.filename, receipt.content_type)

    now = datetime.now(timezone.utc).isoformat()
    await execute_query(
        "UPDATE finance_entries SET entry_date=%s, type=%s, category=%s, amount=%s, description=%s, receipt_media_id=%s, updated_at=%s WHERE id=%s",
        (entry_date, type, category, amount, description, receipt_media_id, now, int(entry_id))
    )
    return {"message": "Entry updated"}

@finance_router.delete("/entries/{entry_id}")
async def delete_finance_entry(entry_id: str, request: Request):
    await require_permission(request, "finance", "delete")
    result = await execute_query("DELETE FROM finance_entries WHERE id = %s", (int(entry_id),))
    if result == 0:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"message": "Entry deleted"}

@finance_router.get("/export")
async def export_finance_entries(request: Request, month: Optional[str] = None, type: Optional[str] = None):
    await require_permission(request, "finance", "view")
    query = "SELECT * FROM finance_entries WHERE 1=1"
    params = []
    if month:
        query += " AND entry_date LIKE %s"
        params.append(f"{month}%")
    if type in ("income", "expense"):
        query += " AND type = %s"
        params.append(type)
    query += " ORDER BY entry_date DESC, id DESC"
    rows = await execute_query(query, tuple(params), fetch_all=True)

    wb = Workbook()
    ws = wb.active
    ws.title = "Income & Expense"
    headers = ["Date", "Type", "Category", "Amount", "Description", "Added By", "Created At"]
    ws.append(headers)
    header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for col_num, _ in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")

    total_income = 0.0
    total_expense = 0.0
    for r in (rows or []):
        amount = float(r["amount"] or 0)
        if r["type"] == "income":
            total_income += amount
        else:
            total_expense += amount
        ws.append([
            r.get("entry_date", ""),
            r.get("type", "").capitalize(),
            r.get("category", ""),
            amount,
            r.get("description", "") or "",
            r.get("created_by_name", "") or "",
            r.get("created_at", "") or "",
        ])

    ws.append([])
    ws.append(["", "", "Total Income", total_income])
    ws.append(["", "", "Total Expense", total_expense])
    ws.append(["", "", "Net Balance", total_income - total_expense])

    for col_letter, width in [("A", 14), ("B", 12), ("C", 22), ("D", 14), ("E", 32), ("F", 20), ("G", 24)]:
        ws.column_dimensions[col_letter].width = width

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    filename = f"income_expense_{month or 'all'}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@finance_router.get("/receipts/{media_id}")
async def serve_finance_receipt(media_id: str, request: Request):
    await require_permission(request, "finance", "view")
    try:
        data, content_type = await _get_image_db(media_id)
        return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=86400"})
    except Exception:
        raise HTTPException(status_code=404, detail="Receipt not found")
