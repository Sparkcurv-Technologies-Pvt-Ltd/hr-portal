"""Contract paperwork: scope of work, the client's PO document, and the agreement (draft → sent → signed, with the signed copy on file)."""

import re

from fastapi import HTTPException

from app.db import execute_query
from app.services import cm_core as core
from app.services.cm_core import Ctx
from app.services.cm_sales import FILE_TYPES, COMPANY_NAME, _contract_or_404, contract_out, _CONTRACT_SELECT
from app.services.proposal_pdf import generate_agreement_pdf, generate_scope_pdf

KINDS = ("PO", "AGREEMENT", "SIGNED_AGREEMENT", "OTHER")
AGREEMENT_STATUSES = ("NONE", "DRAFT", "SENT", "SIGNED")
_ORDER = {s: i for i, s in enumerate(AGREEMENT_STATUSES)}


async def _fresh(ctx: Ctx, contract_id: int) -> dict:
    return contract_out(await _contract_or_404(ctx, contract_id))


async def update_agreement(ctx: Ctx, contract_id: int, data) -> dict:
    """Scope / agreement wording and status. Managers only. Marking SIGNED needs the signed copy on file and the signing date."""
    core.require_manager(ctx)
    k = await _contract_or_404(ctx, contract_id)
    if k["status"] in ("COMPLETED", "TERMINATED"):
        raise HTTPException(status_code=400, detail="This contract is closed")
    changes = {kk: v for kk, v in data.model_dump().items() if kk in data.model_fields_set}
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update")
    current = k.get("agreement_status") or "NONE"
    if (k.get("agreement_status") or "NONE") == "SIGNED" and ({"scope_of_work", "agreement_terms"} & changes.keys()):
        raise HTTPException(status_code=400, detail="The agreement is signed — its wording can no longer be changed")
    if "agreement_status" in changes:
        new = core.check(changes["agreement_status"], AGREEMENT_STATUSES, "agreement status")
        if _ORDER[new] < _ORDER[current] and current == "SIGNED":
            raise HTTPException(status_code=400, detail="A signed agreement can't be moved back")
        if new == "SIGNED":
            signed_on = core.clean_date(changes.get("agreement_signed_on") or k.get("agreement_signed_on"), "Signed on")
            if not signed_on:
                raise HTTPException(status_code=400, detail="Enter the date the agreement was signed")
            files = await execute_query("SELECT COUNT(*) AS n FROM contract_files WHERE contract_id = %s AND kind = 'SIGNED_AGREEMENT'", (contract_id,), fetch_one=True)
            if not files["n"]:
                raise HTTPException(status_code=400, detail="Upload the signed copy of the agreement first")
            changes["agreement_signed_on"] = signed_on
        changes["agreement_status"] = new
    elif "agreement_signed_on" in changes:
        changes["agreement_signed_on"] = core.clean_date(changes["agreement_signed_on"], "Signed on")
    changes["updated_at"] = core.now_iso()
    await execute_query(f"UPDATE contracts SET {', '.join(f'{c} = %s' for c in changes)} WHERE id = %s", (*changes.values(), contract_id))
    return await _fresh(ctx, contract_id)


async def list_files(ctx: Ctx, contract_id: int) -> list:
    await _contract_or_404(ctx, contract_id)
    return [dict(r) for r in (await execute_query("SELECT id, kind, filename, content_type, size_bytes, uploaded_at FROM contract_files WHERE contract_id = %s ORDER BY id", (contract_id,), fetch_all=True) or [])]


async def upload_file(ctx: Ctx, contract_id: int, kind: str, filename: str, data: bytes, max_bytes: int) -> dict:
    core.require_manager(ctx)
    k = await _contract_or_404(ctx, contract_id)
    kind = core.check((kind or "").upper(), KINDS, "file kind")
    if k["status"] in ("COMPLETED", "TERMINATED"):
        raise HTTPException(status_code=400, detail="This contract is closed")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in FILE_TYPES:
        raise HTTPException(status_code=400, detail=f"Allowed file types: {', '.join(FILE_TYPES)}")
    if not data or len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"The file must be between 1 byte and {max_bytes // (1024 * 1024)} MB")
    fid = await execute_query("INSERT INTO contract_files (contract_id, kind, filename, content_type, size_bytes, data, uploaded_by, uploaded_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                              (contract_id, kind, re.sub(r"[^\w.\- ]", "_", filename)[:200], FILE_TYPES[ext], len(data), data, ctx.uid, core.now_iso()), last_id=True)
    return {"id": fid, "kind": kind, "filename": filename, "size_bytes": len(data)}


async def get_file(ctx: Ctx, contract_id: int, file_id: int) -> dict:
    await _contract_or_404(ctx, contract_id)
    f = await execute_query("SELECT filename, content_type, data FROM contract_files WHERE id = %s AND contract_id = %s", (file_id, contract_id), fetch_one=True)
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    return {"filename": f["filename"], "content_type": f["content_type"], "data": bytes(f["data"])}


async def delete_file(ctx: Ctx, contract_id: int, file_id: int) -> None:
    core.require_manager(ctx)
    k = await _contract_or_404(ctx, contract_id)
    f = await execute_query("SELECT kind FROM contract_files WHERE id = %s AND contract_id = %s", (file_id, contract_id), fetch_one=True)
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    if f["kind"] == "SIGNED_AGREEMENT" and k.get("agreement_status") == "SIGNED":
        raise HTTPException(status_code=400, detail="The agreement is marked signed — its signed copy can't be removed")
    await execute_query("DELETE FROM contract_files WHERE id = %s AND contract_id = %s", (file_id, contract_id))


async def agreement_pdf(ctx: Ctx, contract_id: int):
    k = await _contract_or_404(ctx, contract_id)
    client = await core.client_or_404(k["client_id"])
    return generate_agreement_pdf(contract_out(k), dict(client))


async def scope_pdf(ctx: Ctx, contract_id: int):
    k = await _contract_or_404(ctx, contract_id)
    client = await core.client_or_404(k["client_id"])
    proposal_code = ""
    if k["proposal_id"]:
        p = await execute_query("SELECT code FROM proposals WHERE id = %s", (k["proposal_id"],), fetch_one=True)
        proposal_code = p["code"] if p else ""
    return generate_scope_pdf(contract_out(k), dict(client), proposal_code)
