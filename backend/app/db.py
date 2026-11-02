"""aiomysql connection pool and the ``execute_query`` helper.

The pool is created lazily on first use. It lives in this module only: other modules
must access it as ``db.pool`` (never ``from app.db import pool``) so they always see the
current value after late initialisation.
"""

import os

import aiomysql


# MySQL connection pool
pool = None

async def get_pool():
    global pool
    if pool is None:
        pool = await aiomysql.create_pool(
            host=os.environ.get("MYSQL_HOST", "localhost"),
            port=int(os.environ.get("MYSQL_PORT", 3306)),
            user=os.environ.get("MYSQL_USER", "hruser"),
            password=os.environ.get("MYSQL_PASSWORD", "hrpass123"),
            db=os.environ.get("MYSQL_DB", "hr_portal"),
            autocommit=True,
            minsize=2,
            maxsize=10,
            charset='utf8mb4'
        )
    return pool

async def execute_query(query, args=None, fetch_one=False, fetch_all=False, last_id=False):
    p = await get_pool()
    async with p.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(query, args)
            if last_id:
                return cur.lastrowid
            if fetch_one:
                return await cur.fetchone()
            if fetch_all:
                return await cur.fetchall()
            return cur.rowcount
