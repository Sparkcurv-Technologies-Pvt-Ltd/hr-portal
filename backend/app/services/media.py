"""Binary media (images, receipts) stored in the MySQL ``media`` table."""

import uuid as _uuid

from app.core.config import MIME_TYPES
from app.db import execute_query


async def _save_image_db(data: bytes, filename: str) -> str:
    """Store image bytes in the media table, return unique media_id."""
    media_id = _uuid.uuid4().hex
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    content_type = MIME_TYPES.get(ext, "image/jpeg")
    await execute_query(
        "INSERT INTO media (media_id, filename, content_type, data) VALUES (%s, %s, %s, %s)",
        (media_id, filename, content_type, data)
    )
    return media_id

async def _get_image_db(media_id: str) -> tuple:
    """Retrieve image bytes and content_type from media table."""
    row = await execute_query("SELECT data, content_type FROM media WHERE media_id = %s", (media_id,), fetch_one=True)
    if not row:
        raise FileNotFoundError(f"Media not found: {media_id}")
    return bytes(row["data"]), row["content_type"]


async def _save_receipt_db(data: bytes, filename: str, content_type: str) -> str:
    media_id = _uuid.uuid4().hex
    await execute_query(
        "INSERT INTO media (media_id, filename, content_type, data) VALUES (%s, %s, %s, %s)",
        (media_id, filename, content_type, data)
    )
    return media_id
