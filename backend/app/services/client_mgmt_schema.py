"""Client Management schema migration (revision ``client_mgmt_001``).

The project has no Alembic: schema changes are idempotent startup statements. This module keeps that convention and adds a small
revision chain (``schema_revisions``) plus a real ``downgrade``:

    cd backend && venv/bin/python -m app.services.client_mgmt_schema upgrade     # apply (also runs automatically at startup)
    cd backend && venv/bin/python -m app.services.client_mgmt_schema downgrade   # drop the new tables and the added columns

What it does:
- ``clients`` and ``projects`` already exist (clients already existed, projects are the project board). They are **extended**
  with new columns, never duplicated: clients get code / GSTIN / billing address / contact person / default TDS % / default retention %, and
  projects get a ``client_id`` and ``contract_id`` so a contract's engagement is an ordinary project.
- Every other table is new (``CREATE TABLE IF NOT EXISTS``, so anything that already exists is skipped).

``prefix`` prepends a string to every table name; the tests use it to exercise the migration on empty copies without touching real tables.
Revision chain: ``baseline`` (the existing startup migrations) → ``client_mgmt_001``.
"""

import asyncio
import sys
from datetime import datetime, timezone

from app.db import execute_query

REVISIONS = ("client_mgmt_001", "client_mgmt_002")   # 001: the first release; 002: the Sales CRM design (leads / accounts / opportunities / follow-up cadence / activity log)
REVISION = REVISIONS[-1]
DOWN_REVISION = "baseline"

# Pre-existing tables this migration extends. The base definition is only used when the table doesn't exist yet (fresh or prefixed copy).
BASE_TABLES = {
    "clients": """
        CREATE TABLE IF NOT EXISTS {p}clients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            email VARCHAR(255) DEFAULT '',
            phone VARCHAR(50) DEFAULT '',
            address TEXT,
            notes TEXT,
            status VARCHAR(20) DEFAULT 'active',
            created_at VARCHAR(64),
            UNIQUE KEY uk_client_name (name)
        )""",
    "projects": """
        CREATE TABLE IF NOT EXISTS {p}projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            project_key VARCHAR(10) NOT NULL,
            description TEXT,
            status VARCHAR(20) DEFAULT 'active',
            owner_id INT,
            created_at VARCHAR(64),
            updated_at VARCHAR(64),
            UNIQUE KEY uk_project_key (project_key)
        )""",
}
# table -> [(column, definition)] added to those tables
ADDED_COLUMNS = {
    "clients": [("code", "VARCHAR(24) NULL"), ("gstin", "VARCHAR(20) NULL"), ("billing_address", "TEXT NULL"), ("contact_person", "VARCHAR(200) NULL"),
                ("default_tds_pct", "DECIMAL(5,2) NOT NULL DEFAULT 0"), ("default_retention_pct", "DECIMAL(5,2) NOT NULL DEFAULT 0")],
    "projects": [("client_id", "INT NULL"), ("contract_id", "INT NULL")],
}
# Accounts (the sheet's "Accounts") are the existing clients table, so billing details (GSTIN, TDS) stay where invoices need them
ADDED_COLUMNS["clients"] += [("industry", "VARCHAR(40) NULL"), ("location", "VARCHAR(200) NULL"), ("website", "VARCHAR(255) NULL"),
                             ("account_type", "VARCHAR(20) NOT NULL DEFAULT 'Prospect'"), ("owner_id", "INT NULL"), ("owner_label", "VARCHAR(100) NULL")]

TABLES = {
    "leads": """
        CREATE TABLE IF NOT EXISTS {p}leads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            source VARCHAR(20) NOT NULL DEFAULT 'OTHER',
            client_id INT,
            company_name VARCHAR(200),
            contact_name VARCHAR(200),
            phone VARCHAR(40),
            email VARCHAR(255),
            phone_norm VARCHAR(20),
            email_norm VARCHAR(255),
            estimated_value DECIMAL(16,2),
            owner_id INT,
            stage VARCHAR(10) NOT NULL DEFAULT 'NEW',
            next_followup_at VARCHAR(10),
            lost_reason VARCHAR(500),
            created_by INT,
            created_at VARCHAR(64),
            updated_at VARCHAR(64),
            won_at VARCHAR(64),
            lost_at VARCHAR(64),
            UNIQUE KEY uk_lead_code (code),
            KEY idx_lead_stage (stage),
            KEY idx_lead_owner (owner_id),
            KEY idx_lead_email (email_norm),
            KEY idx_lead_phone (phone_norm),
            KEY idx_lead_followup (next_followup_at)
        )""",
    "lead_activities": """
        CREATE TABLE IF NOT EXISTS {p}lead_activities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lead_id INT NOT NULL,
            kind VARCHAR(14) NOT NULL,
            body TEXT,
            by_user_id INT,
            by_user_name VARCHAR(255),
            at VARCHAR(64) NOT NULL,
            KEY idx_activity_lead (lead_id)
        )""",
    "tenders": """
        CREATE TABLE IF NOT EXISTS {p}tenders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lead_id INT NOT NULL,
            reference VARCHAR(120),
            due_date VARCHAR(10),
            status VARCHAR(10) NOT NULL DEFAULT 'OPEN',
            notes TEXT,
            created_by INT,
            created_at VARCHAR(64),
            KEY idx_tender_lead (lead_id)
        )""",
    "proposals": """
        CREATE TABLE IF NOT EXISTS {p}proposals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            lead_id INT NOT NULL,
            tender_id INT,
            client_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            status VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
            review_status VARCHAR(14) NOT NULL DEFAULT 'PENDING',
            review_note TEXT,
            reviewed_by INT,
            reviewed_at VARCHAR(64),
            total_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
            total_cost DECIMAL(16,2) NOT NULL DEFAULT 0,
            terms TEXT,
            valid_until VARCHAR(10),
            sent_at VARCHAR(64),
            sent_to VARCHAR(255),
            override_reason TEXT,
            public_token VARCHAR(64),
            client_response VARCHAR(14),
            client_response_at VARCHAR(64),
            client_message TEXT,
            owner_id INT,
            created_by INT,
            created_at VARCHAR(64),
            updated_at VARCHAR(64),
            UNIQUE KEY uk_proposal_code (code),
            UNIQUE KEY uk_proposal_token (public_token),
            KEY idx_proposal_lead (lead_id),
            KEY idx_proposal_client (client_id)
        )""",
    "proposal_items": """
        CREATE TABLE IF NOT EXISTS {p}proposal_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            proposal_id INT NOT NULL,
            line_no INT NOT NULL,
            description VARCHAR(500) NOT NULL,
            quantity DECIMAL(14,3) NOT NULL DEFAULT 1,
            unit VARCHAR(30) DEFAULT '',
            rate DECIMAL(16,2) NOT NULL DEFAULT 0,
            cost DECIMAL(16,2) NOT NULL DEFAULT 0,
            KEY idx_item_proposal (proposal_id)
        )""",
    "proposal_files": """
        CREATE TABLE IF NOT EXISTS {p}proposal_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            proposal_id INT NOT NULL,
            filename VARCHAR(255) NOT NULL,
            content_type VARCHAR(100) NOT NULL,
            size_bytes INT NOT NULL,
            data LONGBLOB NOT NULL,
            uploaded_by INT,
            uploaded_at VARCHAR(64),
            KEY idx_pfile_proposal (proposal_id)
        )""",
    "contracts": """
        CREATE TABLE IF NOT EXISTS {p}contracts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            client_id INT NOT NULL,
            proposal_id INT,
            lead_id INT,
            contract_no VARCHAR(80),
            po_date VARCHAR(10),
            po_reference VARCHAR(120),
            contract_value DECIMAL(16,2) NOT NULL DEFAULT 0,
            start_date VARCHAR(10),
            end_date VARCHAR(10),
            status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
            estimated_cost DECIMAL(16,2) NOT NULL DEFAULT 0,
            engagement_project_id INT,
            booked_by INT,
            created_at VARCHAR(64),
            updated_at VARCHAR(64),
            UNIQUE KEY uk_contract_code (code),
            UNIQUE KEY uk_contract_proposal (proposal_id),
            KEY idx_contract_client (client_id),
            KEY idx_contract_status (status)
        )""",
    "invoices": """
        CREATE TABLE IF NOT EXISTS {p}invoices (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            contract_id INT NOT NULL,
            client_id INT NOT NULL,
            period VARCHAR(7) NOT NULL,
            invoice_date VARCHAR(10),
            gross_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
            tax_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
            tax_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
            tds_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
            tds_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
            retention_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
            retention_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
            net_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
            status VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
            generated_by VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
            notes TEXT,
            created_by INT,
            created_at VARCHAR(64),
            posted_by INT,
            posted_at VARCHAR(64),
            cancelled_by INT,
            cancelled_at VARCHAR(64),
            cancel_reason TEXT,
            UNIQUE KEY uk_invoice_code (code),
            KEY idx_invoice_contract (contract_id, period),
            KEY idx_invoice_client (client_id, status)
        )""",
    "client_payments": """
        CREATE TABLE IF NOT EXISTS {p}client_payments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            client_id INT NOT NULL,
            amount DECIMAL(16,2) NOT NULL,
            payment_date VARCHAR(10) NOT NULL,
            reference VARCHAR(120),
            status VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
            notes TEXT,
            created_by INT,
            created_at VARCHAR(64),
            posted_by INT,
            posted_at VARCHAR(64),
            cancelled_by INT,
            cancelled_at VARCHAR(64),
            cancel_reason TEXT,
            UNIQUE KEY uk_payment_code (code),
            KEY idx_payment_client (client_id, status)
        )""",
    "payment_allocations": """
        CREATE TABLE IF NOT EXISTS {p}payment_allocations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            payment_id INT NOT NULL,
            invoice_id INT NOT NULL,
            amount DECIMAL(16,2) NOT NULL,
            created_by INT,
            created_at VARCHAR(64),
            released_at VARCHAR(64),
            KEY idx_alloc_payment (payment_id),
            KEY idx_alloc_invoice (invoice_id)
        )""",
    "client_advances": """
        CREATE TABLE IF NOT EXISTS {p}client_advances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            client_id INT NOT NULL,
            amount DECIMAL(16,2) NOT NULL,
            advance_date VARCHAR(10) NOT NULL,
            reference VARCHAR(120),
            status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
            notes TEXT,
            created_by INT,
            created_at VARCHAR(64),
            cancelled_by INT,
            cancelled_at VARCHAR(64),
            cancel_reason TEXT,
            UNIQUE KEY uk_advance_code (code),
            KEY idx_advance_client (client_id, status)
        )""",
    "advance_adjustments": """
        CREATE TABLE IF NOT EXISTS {p}advance_adjustments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            advance_id INT NOT NULL,
            invoice_id INT NOT NULL,
            amount DECIMAL(16,2) NOT NULL,
            created_by INT,
            created_at VARCHAR(64),
            released_at VARCHAR(64),
            KEY idx_adj_advance (advance_id),
            KEY idx_adj_invoice (invoice_id)
        )""",
}
EXTRA_COLUMNS = {      # columns added to our own tables after the first release (applied after the tables exist; dropped with the tables on downgrade)
    "proposals": [("scope_of_work", "TEXT NULL"), ("tax_pct", "DECIMAL(5,2) NOT NULL DEFAULT 18"), ("opportunity_id", "INT NULL")],
    "contracts": [("scope_of_work", "TEXT NULL"), ("agreement_terms", "TEXT NULL"), ("agreement_status", "VARCHAR(10) NOT NULL DEFAULT 'NONE'"), ("agreement_signed_on", "VARCHAR(10) NULL"),
                  ("opportunity_id", "INT NULL")],
    "invoices": [("emailed_at", "VARCHAR(64) NULL"), ("emailed_to", "VARCHAR(255) NULL")],
    # revision 002 — the Sales CRM design: leads carry the sheet's columns and its own status list
    "leads": [("location", "VARCHAR(200) NULL"), ("lead_status", "VARCHAR(12) NOT NULL DEFAULT 'New'"), ("date_added", "VARCHAR(10) NULL"), ("interested_in", "TEXT NULL"),
              ("next_action", "VARCHAR(500) NULL"), ("converted_opp_id", "INT NULL"), ("bdr_label", "VARCHAR(100) NULL")],
}
TABLES["opportunities"] = """
        CREATE TABLE IF NOT EXISTS {p}opportunities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            client_id INT NOT NULL,
            opp_name VARCHAR(255) NOT NULL,
            contact_person VARCHAR(200),
            stage VARCHAR(24) NOT NULL DEFAULT 'Discovery',
            deal_value DECIMAL(16,2) NULL,
            expected_close_date VARCHAR(10),
            lead_source VARCHAR(40),
            owner_id INT,
            bdr_label VARCHAR(100),
            lead_id INT,
            created_date VARCHAR(10),
            last_activity_date VARCHAR(10),
            next_action VARCHAR(500),
            notes TEXT,
            closed_at VARCHAR(64),
            created_by INT,
            created_at VARCHAR(64),
            updated_at VARCHAR(64),
            UNIQUE KEY uk_opp_code (code),
            KEY idx_opp_client (client_id),
            KEY idx_opp_stage (stage),
            KEY idx_opp_owner (owner_id)
        )"""
TABLES["followups"] = """
        CREATE TABLE IF NOT EXISTS {p}followups (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            client_id INT NULL,
            opportunity_id INT NULL,
            company_name VARCHAR(255) NOT NULL,
            contact_person VARCHAR(200),
            owner_id INT,
            bdr_label VARCHAR(100),
            notes TEXT,
            created_at VARCHAR(64),
            updated_at VARCHAR(64),
            UNIQUE KEY uk_followup_code (code),
            KEY idx_followup_owner (owner_id),
            KEY idx_followup_client (client_id)
        )"""
TABLES["followup_steps"] = """
        CREATE TABLE IF NOT EXISTS {p}followup_steps (
            followup_id INT NOT NULL,
            step_no TINYINT NOT NULL,
            step_date VARCHAR(10),
            outcome VARCHAR(14),
            PRIMARY KEY (followup_id, step_no)
        )"""
TABLES["activity_log"] = """
        CREATE TABLE IF NOT EXISTS {p}activity_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(24) NOT NULL,
            log_date VARCHAR(10) NOT NULL,
            owner_id INT,
            bdr_label VARCHAR(100),
            client_id INT NULL,
            lead_id INT NULL,
            opportunity_id INT NULL,
            followup_id INT NULL,
            followup_step TINYINT NULL,
            company_name VARCHAR(255) NOT NULL,
            activity_type VARCHAR(10) NOT NULL,
            outcome VARCHAR(14),
            notes TEXT,
            created_by INT,
            created_at VARCHAR(64),
            UNIQUE KEY uk_activity_code (code),
            UNIQUE KEY uk_activity_step (followup_id, followup_step),
            KEY idx_activity_date (log_date),
            KEY idx_activity_owner (owner_id),
            KEY idx_activity_client (client_id)
        )"""
TABLES["contract_files"] = """
        CREATE TABLE IF NOT EXISTS {p}contract_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            contract_id INT NOT NULL,
            kind VARCHAR(16) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            content_type VARCHAR(100) NOT NULL,
            size_bytes INT NOT NULL,
            data LONGBLOB NOT NULL,
            uploaded_by INT,
            uploaded_at VARCHAR(64),
            KEY idx_cfile_contract (contract_id)
        )"""
REVISIONS_DDL = """
    CREATE TABLE IF NOT EXISTS {p}schema_revisions (
        revision VARCHAR(40) PRIMARY KEY,
        down_revision VARCHAR(40),
        applied_at VARCHAR(64)
    )"""


async def _table_exists(table: str) -> bool:
    return bool(await execute_query("SHOW TABLES LIKE %s", (table,), fetch_all=True))


async def _has_column(table: str, column: str) -> bool:
    return bool(await execute_query(f"SHOW COLUMNS FROM {table} LIKE %s", (column,), fetch_all=True))


async def current_revision(prefix: str = "") -> str:
    """The latest applied revision recorded by this chain ('baseline' when none)."""
    try:
        row = await execute_query(f"SELECT revision FROM {prefix}schema_revisions ORDER BY applied_at DESC LIMIT 1", fetch_one=True)
    except Exception:
        return DOWN_REVISION
    return row["revision"] if row else DOWN_REVISION


async def upgrade(prefix: str = "") -> None:
    """Create the new tables, extend clients/projects, back-fill client codes, and record the revision. Idempotent."""
    await execute_query(REVISIONS_DDL.format(p=prefix))
    for ddl in BASE_TABLES.values():
        await execute_query(ddl.format(p=prefix))                  # no-op when the table already exists
    for table, columns in ADDED_COLUMNS.items():
        for name, definition in columns:
            if not await _has_column(f"{prefix}{table}", name):
                await execute_query(f"ALTER TABLE {prefix}{table} ADD COLUMN {name} {definition}")
    for ddl in TABLES.values():
        await execute_query(ddl.format(p=prefix))
    fresh_leads = not await _has_column(f"{prefix}leads", "lead_status")      # first run of revision 002 on this table: also translate the old values
    for table, columns in EXTRA_COLUMNS.items():
        for name, definition in columns:
            if not await _has_column(f"{prefix}{table}", name):
                await execute_query(f"ALTER TABLE {prefix}{table} ADD COLUMN {name} {definition}")
    await execute_query(f"ALTER TABLE {prefix}clients MODIFY account_type VARCHAR(20) NOT NULL DEFAULT 'Prospect'")
    await execute_query(f"ALTER TABLE {prefix}leads MODIFY source VARCHAR(40) NOT NULL DEFAULT 'Other'")
    await execute_query(f"ALTER TABLE {prefix}proposals MODIFY lead_id INT NULL")
    for old_src, new_src in (("REFERRAL", "Referral"), ("WEBSITE", "Website"), ("EVENT", "Trade Show / Exhibition"), ("COLD_CALL", "Cold Call"), ("TENDER_PORTAL", "Other"), ("PARTNER", "Referral"), ("OTHER", "Other")):
        await execute_query(f"UPDATE {prefix}leads SET source = %s WHERE BINARY source = %s", (new_src, old_src))      # old upper-case codes only (idempotent)
    if fresh_leads:
        for old_stage, status in (("NEW", "New"), ("CONTACTED", "Contacted"), ("QUALIFIED", "Qualified"), ("TENDER", "Qualified"), ("PROPOSAL", "Qualified"), ("WON", "Converted"), ("LOST", "Unqualified")):
            await execute_query(f"UPDATE {prefix}leads SET lead_status = %s WHERE stage = %s", (status, old_stage))
        await execute_query(f"UPDATE {prefix}leads SET date_added = SUBSTRING(created_at, 1, 10) WHERE date_added IS NULL")
    # existing clients get a code (CLI-0001 …); new unique index only after the back-fill
    await execute_query(f"UPDATE {prefix}clients SET code = CONCAT('CLI-', LPAD(id, 4, '0')) WHERE code IS NULL OR code = ''")
    has_index = await execute_query(f"SHOW INDEX FROM {prefix}clients WHERE Key_name = 'uk_client_code'", fetch_all=True)
    if not has_index:
        await execute_query(f"ALTER TABLE {prefix}clients ADD UNIQUE KEY uk_client_code (code)")
    previous = DOWN_REVISION
    for revision in REVISIONS:
        await execute_query(f"INSERT IGNORE INTO {prefix}schema_revisions (revision, down_revision, applied_at) VALUES (%s, %s, %s)", (revision, previous, datetime.now(timezone.utc).isoformat()))
        previous = revision


async def downgrade(prefix: str = "") -> None:
    """Drop the new tables and the columns added to clients / projects. Destroys all client-management data (the clients and projects themselves stay)."""
    for name in reversed(list(TABLES)):
        await execute_query(f"DROP TABLE IF EXISTS {prefix}{name}")
    if await _table_exists(f"{prefix}clients") and await execute_query(f"SHOW INDEX FROM {prefix}clients WHERE Key_name = 'uk_client_code'", fetch_all=True):
        await execute_query(f"ALTER TABLE {prefix}clients DROP INDEX uk_client_code")
    for table, columns in ADDED_COLUMNS.items():
        if not await _table_exists(f"{prefix}{table}"):
            continue
        for name, _ in columns:
            if await _has_column(f"{prefix}{table}", name):
                await execute_query(f"ALTER TABLE {prefix}{table} DROP COLUMN {name}")
    if prefix:                                                      # a prefixed copy of a base table is test scaffolding: remove it too
        for name in BASE_TABLES:
            await execute_query(f"DROP TABLE IF EXISTS {prefix}{name}")
    if await _table_exists(f"{prefix}schema_revisions"):
        await execute_query(f"DELETE FROM {prefix}schema_revisions WHERE revision IN (%s, %s)", REVISIONS)
        remaining = await execute_query(f"SELECT COUNT(*) AS n FROM {prefix}schema_revisions", fetch_one=True)
        if remaining["n"] == 0:
            await execute_query(f"DROP TABLE IF EXISTS {prefix}schema_revisions")


async def table_names(prefix: str = "") -> list:
    rows = await execute_query("SHOW TABLES", fetch_all=True)
    known = {*TABLES, *BASE_TABLES, "schema_revisions"}
    return sorted(n for n in (list(r.values())[0] for r in (rows or [])) if n.startswith(prefix) and n[len(prefix):] in known)


if __name__ == "__main__":   # python -m app.services.client_mgmt_schema upgrade|downgrade
    from dotenv import load_dotenv
    load_dotenv()
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command not in ("upgrade", "downgrade"):
        raise SystemExit("usage: python -m app.services.client_mgmt_schema upgrade|downgrade")

    async def _run():
        from app import db
        await {"upgrade": upgrade, "downgrade": downgrade}[command]()
        if db.pool:
            db.pool.close()
            await db.pool.wait_closed()
    asyncio.run(_run())
    print(f"{command} done")
