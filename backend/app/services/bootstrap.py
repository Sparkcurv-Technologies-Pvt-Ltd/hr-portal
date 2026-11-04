"""Startup tasks: schema creation, migrations, seed data and scheduler start."""

import asyncio
import os
from datetime import datetime, timezone

from app.core.config import DEFAULT_HOLIDAYS, DEFAULT_SALARY_COMPONENTS, FINANCE_DEFAULT_CATEGORIES, ROOT_DIR
from app.core.log import logger
from app.core.security import hash_password
from app.db import execute_query, get_pool
from app.services.media import _save_image_db
from app.services.payroll import _payslip_scheduler_loop
from app.core import email_settings
from app.services import client_mgmt_schema
from app.services.cm_accounts import start_month_end_scheduler
from app.services.cm_reminders import start_cm_reminder_scheduler
from app.services.reminders import start_reminder_scheduler


async def init_database():
    p = await get_pool()
    async with p.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    role ENUM('admin', 'manager', 'employee') DEFAULT 'employee',
                    department VARCHAR(255) DEFAULT 'General',
                    position VARCHAR(255) DEFAULT 'Employee',
                    avatar_url TEXT,
                    created_at VARCHAR(64),
                    casual_leave FLOAT DEFAULT NULL,
                    sick_leave FLOAT DEFAULT NULL,
                    loss_of_pay FLOAT DEFAULT 0,
                    permission_hours FLOAT DEFAULT 2,
                    half_day_leave FLOAT DEFAULT 0,
                    shift VARCHAR(50) DEFAULT '',
                    basic_salary FLOAT DEFAULT 0,
                    employee_code VARCHAR(20) DEFAULT ''
                )
            """)
            # Add wfh_limit column if missing
            try:
                await cur.execute("SELECT wfh_limit FROM users LIMIT 1")
            except Exception:
                await cur.execute("ALTER TABLE users ADD COLUMN wfh_limit INT DEFAULT NULL")
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS wfh_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    user_name VARCHAR(255),
                    user_email VARCHAR(255),
                    date VARCHAR(20),
                    reason TEXT,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at VARCHAR(64),
                    reviewed_by VARCHAR(255),
                    reviewed_at VARCHAR(64),
                    INDEX idx_user_date (user_id, date)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS attendance (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    user_name VARCHAR(255),
                    date VARCHAR(20),
                    clock_in VARCHAR(64),
                    clock_out VARCHAR(64),
                    total_break_minutes INT DEFAULT 0,
                    working_hours FLOAT,
                    is_short_day TINYINT DEFAULT 0,
                    clock_in_lat DOUBLE,
                    clock_in_lng DOUBLE,
                    clock_in_address TEXT,
                    clock_out_lat DOUBLE,
                    clock_out_lng DOUBLE,
                    clock_out_address TEXT,
                    location_type VARCHAR(20),
                    INDEX idx_user_date (user_id, date)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS breaks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    attendance_id INT NOT NULL,
                    break_start VARCHAR(64),
                    break_end VARCHAR(64),
                    break_start_lat DOUBLE,
                    break_start_lng DOUBLE,
                    break_end_lat DOUBLE,
                    break_end_lng DOUBLE,
                    planned_minutes INT DEFAULT NULL,
                    INDEX idx_attendance (attendance_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS pauses (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    attendance_id INT NOT NULL,
                    pause_start VARCHAR(64),
                    pause_end VARCHAR(64),
                    INDEX idx_attendance (attendance_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS leave_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    user_name VARCHAR(255),
                    user_email VARCHAR(255),
                    leave_type VARCHAR(50),
                    start_date VARCHAR(20),
                    end_date VARCHAR(20),
                    days FLOAT DEFAULT 0,
                    reason TEXT,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at VARCHAR(64),
                    reviewed_by VARCHAR(255),
                    reviewed_at VARCHAR(64),
                    is_half_day TINYINT DEFAULT 0,
                    INDEX idx_user_status (user_id, status)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS permissions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    user_name VARCHAR(255),
                    user_email VARCHAR(255),
                    duration_minutes INT,
                    reason TEXT,
                    date VARCHAR(20),
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at VARCHAR(64),
                    reviewed_by VARCHAR(255),
                    reviewed_at VARCHAR(64),
                    INDEX idx_user_date (user_id, date)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS payslips (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    employee_id INT NOT NULL,
                    employee_name VARCHAR(255),
                    employee_email VARCHAR(255),
                    department VARCHAR(255),
                    position VARCHAR(255),
                    month INT,
                    year INT,
                    month_name VARCHAR(20),
                    basic_salary FLOAT,
                    deduction_details TEXT,
                    total_deductions FLOAT DEFAULT 0,
                    net_pay FLOAT DEFAULT 0,
                    generated_by VARCHAR(255),
                    created_at VARCHAR(64),
                    UNIQUE KEY uk_emp_month_year (employee_id, month, year)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS leave_deductions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    type VARCHAR(50),
                    amount FLOAT,
                    reason TEXT,
                    date VARCHAR(64)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS custom_deductions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    deduction_name VARCHAR(100) NOT NULL,
                    amount FLOAT DEFAULT 0,
                    is_percentage TINYINT DEFAULT 0,
                    percentage FLOAT DEFAULT 0,
                    is_active TINYINT DEFAULT 1,
                    created_at VARCHAR(64),
                    INDEX idx_user (user_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS payroll_runs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    month INT NOT NULL,
                    year INT NOT NULL,
                    total_employees INT DEFAULT 0,
                    total_gross FLOAT DEFAULT 0,
                    total_deductions FLOAT DEFAULT 0,
                    total_net FLOAT DEFAULT 0,
                    processed_by VARCHAR(255),
                    processed_at VARCHAR(64),
                    UNIQUE KEY uk_month_year (month, year)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    project_key VARCHAR(10) NOT NULL,
                    description TEXT,
                    status VARCHAR(20) DEFAULT 'active',
                    owner_id INT,
                    created_at VARCHAR(64),
                    updated_at VARCHAR(64),
                    UNIQUE KEY uk_project_key (project_key)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS sprints (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    project_id INT NOT NULL,
                    name VARCHAR(150) NOT NULL,
                    goal TEXT,
                    status VARCHAR(20) DEFAULT 'planned',
                    start_date VARCHAR(10),
                    end_date VARCHAR(10),
                    created_at VARCHAR(64),
                    completed_at VARCHAR(64),
                    KEY idx_sprint_project (project_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    project_id INT NOT NULL,
                    issue_number INT NOT NULL,
                    issue_type VARCHAR(20) DEFAULT 'task',
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    status VARCHAR(20) DEFAULT 'todo',
                    priority VARCHAR(20) DEFAULT 'medium',
                    labels VARCHAR(255) DEFAULT '',
                    story_points INT,
                    sprint_id INT,
                    assignee_id INT,
                    created_by INT,
                    due_date VARCHAR(10),
                    created_at VARCHAR(64),
                    updated_at VARCHAR(64),
                    completed_at VARCHAR(64),
                    UNIQUE KEY uk_issue (project_id, issue_number),
                    KEY idx_task_assignee (assignee_id),
                    KEY idx_task_sprint (sprint_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS task_activity (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    task_id INT NOT NULL,
                    user_id INT,
                    user_name VARCHAR(255),
                    field VARCHAR(40) NOT NULL,
                    old_value VARCHAR(255),
                    new_value VARCHAR(255),
                    created_at VARCHAR(64),
                    KEY idx_activity_task (task_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS task_comments (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    task_id INT NOT NULL,
                    user_id INT,
                    body TEXT NOT NULL,
                    created_at VARCHAR(64),
                    KEY idx_comment_task (task_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS clients (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    email VARCHAR(255) DEFAULT '',
                    phone VARCHAR(50) DEFAULT '',
                    address TEXT,
                    notes TEXT,
                    status VARCHAR(20) DEFAULT 'active',
                    created_at VARCHAR(64),
                    UNIQUE KEY uk_client_name (name)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS user_email_mutes (
                    user_id INT NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    PRIMARY KEY (user_id, category)
                )
            """)

            await cur.execute("""
                CREATE TABLE IF NOT EXISTS holidays (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    date VARCHAR(10) NOT NULL,
                    festival VARCHAR(150) NOT NULL,
                    created_at VARCHAR(64),
                    updated_at VARCHAR(64),
                    UNIQUE KEY uk_holiday_date (date)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS policies (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(100),
                    content TEXT,
                    icon VARCHAR(50) DEFAULT 'article',
                    sort_order INT DEFAULT 0,
                    created_at VARCHAR(64),
                    updated_at VARCHAR(64)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS change_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    requester_id INT NOT NULL,
                    requester_name VARCHAR(255),
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    cr_type VARCHAR(100) DEFAULT 'General',
                    priority VARCHAR(20) DEFAULT 'medium',
                    status VARCHAR(30) DEFAULT 'pending',
                    manager_approval VARCHAR(20) DEFAULT 'pending',
                    manager_id INT,
                    manager_name VARCHAR(255),
                    manager_notes TEXT,
                    manager_action_at VARCHAR(64),
                    admin_approval VARCHAR(20) DEFAULT 'pending',
                    admin_id INT,
                    admin_name VARCHAR(255),
                    admin_notes TEXT,
                    admin_action_at VARCHAR(64),
                    metadata TEXT,
                    applied_changes TEXT,
                    created_at VARCHAR(64),
                    updated_at VARCHAR(64),
                    INDEX idx_requester (requester_id),
                    INDEX idx_status (status)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS office_settings (
                    id INT PRIMARY KEY DEFAULT 1,
                    latitude DOUBLE NOT NULL,
                    longitude DOUBLE NOT NULL,
                    radius_km FLOAT DEFAULT 0.5,
                    office_name VARCHAR(255) DEFAULT 'Office',
                    address VARCHAR(512) DEFAULT '',
                    updated_at VARCHAR(64)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS org_chart (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    parent_id INT,
                    employee_name VARCHAR(255) NOT NULL,
                    job_title VARCHAR(255),
                    image_url TEXT,
                    description TEXT,
                    level_num INT DEFAULT 0,
                    sort_order INT DEFAULT 0,
                    created_at VARCHAR(64)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS org_levels (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    level_num INT NOT NULL,
                    label VARCHAR(100) NOT NULL DEFAULT 'Level',
                    updated_at VARCHAR(64),
                    UNIQUE KEY uk_level_num (level_num)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS user_permissions (
                    user_id INT NOT NULL,
                    module VARCHAR(50) NOT NULL,
                    can_view TINYINT NOT NULL DEFAULT 0,
                    can_edit TINYINT NOT NULL DEFAULT 0,
                    can_delete TINYINT NOT NULL DEFAULT 0,
                    updated_at VARCHAR(64),
                    PRIMARY KEY (user_id, module)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS vault_items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(200) NOT NULL,
                    category VARCHAR(60) DEFAULT 'General',
                    username VARCHAR(255) DEFAULT '',
                    url VARCHAR(500) DEFAULT '',
                    secret_enc TEXT NOT NULL,
                    notes_enc TEXT,
                    created_by VARCHAR(255),
                    updated_by VARCHAR(255),
                    created_at VARCHAR(64),
                    updated_at VARCHAR(64)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS vault_shares (
                    item_id INT NOT NULL,
                    user_id INT NOT NULL,
                    can_edit TINYINT NOT NULL DEFAULT 0,
                    created_at VARCHAR(64),
                    PRIMARY KEY (item_id, user_id),
                    INDEX idx_vault_share_user (user_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS vault_audit (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    item_id INT,
                    item_title VARCHAR(200),
                    user_id INT,
                    user_name VARCHAR(255),
                    action VARCHAR(20) NOT NULL,
                    detail VARCHAR(300) DEFAULT '',
                    ip VARCHAR(64) DEFAULT '',
                    created_at VARCHAR(64),
                    INDEX idx_vault_audit_item (item_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS reminder_log (
                    user_id INT NOT NULL,
                    date VARCHAR(10) NOT NULL,
                    kind VARCHAR(20) NOT NULL,
                    sent_at VARCHAR(64),
                    PRIMARY KEY (user_id, date, kind)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS media (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    media_id VARCHAR(64) NOT NULL,
                    filename VARCHAR(255) NOT NULL,
                    content_type VARCHAR(64) NOT NULL DEFAULT 'image/jpeg',
                    data MEDIUMBLOB NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_media_id (media_id)
                )
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS finance_categories (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    type VARCHAR(10) NOT NULL
                )
            """)
            await cur.execute("SELECT COUNT(*) as cnt FROM finance_categories")
            row = await cur.fetchone()
            if row and row[0] == 0:
                for name, ftype in FINANCE_DEFAULT_CATEGORIES:
                    await cur.execute("INSERT INTO finance_categories (name, type) VALUES (%s, %s)", (name, ftype))
                logger.info("Seeded default finance categories")
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS finance_entries (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    entry_date VARCHAR(20) NOT NULL,
                    type VARCHAR(10) NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    amount DECIMAL(12,2) NOT NULL,
                    description TEXT,
                    receipt_media_id VARCHAR(64) DEFAULT NULL,
                    created_by INT NOT NULL,
                    created_by_name VARCHAR(255),
                    created_at VARCHAR(64) NOT NULL,
                    updated_at VARCHAR(64) NOT NULL,
                    INDEX idx_entry_date (entry_date)
                )
            """)

async def startup():
    import traceback
    try:
        logger.info("Connecting to MySQL...")
        logger.info(f"  Host: {os.environ.get('MYSQL_HOST', 'localhost')}")
        logger.info(f"  Port: {os.environ.get('MYSQL_PORT', '3306')}")
        logger.info(f"  Database: {os.environ.get('MYSQL_DB', 'hr_portal')}")
        logger.info(f"  User: {os.environ.get('MYSQL_USER', 'hruser')}")

        await init_database()
        logger.info("All tables created/verified successfully")

        # Migration: Add employee_code column if missing
        try:
            await execute_query("SELECT employee_code FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN employee_code VARCHAR(20) DEFAULT ''")
                logger.info("Added employee_code column to users table")
            except Exception as e:
                logger.warning(f"Could not add employee_code column: {e}")

        # Migration: Add is_half_day to leave_requests and change days to FLOAT
        try:
            await execute_query("SELECT is_half_day FROM leave_requests LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE leave_requests ADD COLUMN is_half_day TINYINT DEFAULT 0")
                logger.info("Added is_half_day column to leave_requests")
            except Exception as e:
                logger.warning(f"Could not add is_half_day column: {e}")
        try:
            await execute_query("ALTER TABLE leave_requests MODIFY COLUMN days FLOAT DEFAULT 0")
        except Exception:
            pass

        # Migration: Add wfh_limit to users
        try:
            await execute_query("SELECT wfh_limit FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN wfh_limit INT DEFAULT NULL")
                logger.info("Added wfh_limit column to users")
            except Exception as e:
                logger.warning(f"Could not add wfh_limit column: {e}")

        # Migration: Add geofence_bypass to office_settings
        try:
            await execute_query("SELECT geofence_bypass FROM office_settings LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE office_settings ADD COLUMN geofence_bypass TINYINT(1) DEFAULT 0")
                logger.info("Added geofence_bypass column to office_settings")
            except Exception as e:
                logger.warning(f"Could not add geofence_bypass column: {e}")

        # Migration: Add gps_tracking_enabled to users
        try:
            await execute_query("SELECT gps_tracking_enabled FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN gps_tracking_enabled TINYINT(1) DEFAULT 1")
                logger.info("Added gps_tracking_enabled column to users")
            except Exception as e:
                logger.warning(f"Could not add gps_tracking_enabled column: {e}")

        # Migration: Add timer_access_enabled to users
        try:
            await execute_query("SELECT timer_access_enabled FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN timer_access_enabled TINYINT(1) DEFAULT 0")
                logger.info("Added timer_access_enabled column to users")
            except Exception as e:
                logger.warning(f"Could not add timer_access_enabled column: {e}")

        # Migration: per-employee switch for receiving email notifications (1 = on, the default)
        try:
            await execute_query("SELECT email_notifications FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN email_notifications TINYINT(1) DEFAULT 1")
                logger.info("Added email_notifications column to users")
            except Exception as e:
                logger.warning(f"Could not add email_notifications column: {e}")

        # Migration: per-employee switch for the 8-hour Logout rule (1 = Logout blocked until 8h, the default)
        try:
            await execute_query("SELECT full_day_required FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN full_day_required TINYINT(1) DEFAULT 1")
                logger.info("Added full_day_required column to users")
            except Exception as e:
                logger.warning(f"Could not add full_day_required column: {e}")

        # Migration: who granted each management permission (employees' grants count only from a superadmin)
        try:
            await execute_query("SELECT granted_by FROM user_permissions LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE user_permissions ADD COLUMN granted_by INT DEFAULT NULL")
                logger.info("Added granted_by column to user_permissions")
            except Exception as e:
                logger.warning(f"Could not add granted_by to user_permissions: {e}")

        # Migration: vault editors (employees allowed to add credentials and manage the ones they create)
        for table, column, ddl in (("users", "vault_editor", "TINYINT(1) DEFAULT 0"), ("vault_items", "owner_id", "INT DEFAULT NULL")):
            try:
                await execute_query(f"SELECT {column} FROM {table} LIMIT 1", fetch_one=True)
            except Exception:
                try:
                    await execute_query(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
                    logger.info(f"Added {column} column to {table}")
                except Exception as e:
                    logger.warning(f"Could not add {column} to {table}: {e}")

        # Create time_tracker_sessions table
        await execute_query("""
            CREATE TABLE IF NOT EXISTS time_tracker_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                user_name VARCHAR(255),
                date VARCHAR(20) NOT NULL,
                started_at VARCHAR(64) NOT NULL,
                stopped_at VARCHAR(64) DEFAULT NULL,
                duration_seconds INT DEFAULT 0,
                INDEX idx_tts_user_date (user_id, date)
            )
        """)

        # Migration: Add location columns to attendance
        for col in ["clock_in_lat DOUBLE", "clock_in_lng DOUBLE", "clock_in_address TEXT", "clock_out_lat DOUBLE", "clock_out_lng DOUBLE", "clock_out_address TEXT", "location_type VARCHAR(20)", "is_emergency_clockout TINYINT DEFAULT 0", "emergency_reason TEXT"]:
            col_name = col.split()[0]
            try:
                await execute_query(f"SELECT {col_name} FROM attendance LIMIT 1", fetch_one=True)
            except Exception:
                try:
                    await execute_query(f"ALTER TABLE attendance ADD COLUMN {col}")
                    logger.info(f"Added {col_name} to attendance")
                except Exception:
                    pass

        # Migration: Add location columns to breaks
        for col in ["break_start_lat DOUBLE", "break_start_lng DOUBLE", "break_end_lat DOUBLE", "break_end_lng DOUBLE"]:
            col_name = col.split()[0]
            try:
                await execute_query(f"SELECT {col_name} FROM breaks LIMIT 1", fetch_one=True)
            except Exception:
                try:
                    await execute_query(f"ALTER TABLE breaks ADD COLUMN {col}")
                    logger.info(f"Added {col_name} to breaks")
                except Exception:
                    pass

        # Migration: Add metadata and applied_changes to change_requests
        for col in ["metadata TEXT", "applied_changes TEXT"]:
            col_name = col.split()[0]
            try:
                await execute_query(f"SELECT {col_name} FROM change_requests LIMIT 1", fetch_one=True)
            except Exception:
                try:
                    await execute_query(f"ALTER TABLE change_requests ADD COLUMN {col}")
                    logger.info(f"Added {col_name} to change_requests")
                except Exception as e:
                    logger.warning(f"Could not add {col_name} to change_requests: {e}")

        # Migration: chosen break length (5/10/20 min) per break
        try:
            await execute_query("SELECT planned_minutes FROM breaks LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE breaks ADD COLUMN planned_minutes INT DEFAULT NULL")
            except Exception as e:
                logger.warning(f"Could not add planned_minutes to breaks: {e}")

        # Migration: Add cr_number to change_requests
        try:
            await execute_query("SELECT cr_number FROM change_requests LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE change_requests ADD COLUMN cr_number VARCHAR(30) AFTER id")
                # Backfill existing rows
                rows = await execute_query("SELECT id, created_at FROM change_requests ORDER BY id", fetch_all=True)
                year_now = datetime.now(timezone.utc).year
                for i, row in enumerate(rows or [], start=1):
                    try:
                        yr = int(str(row.get("created_at",""))[:4]) if row.get("created_at") else year_now
                    except Exception:
                        yr = year_now
                    cn = f"CR-{yr}-{i:04d}"
                    await execute_query("UPDATE change_requests SET cr_number=%s WHERE id=%s", (cn, row["id"]))
                logger.info("Added cr_number to change_requests and backfilled")
            except Exception as e:
                logger.warning(f"Could not add cr_number: {e}")

        # Migration: Add reporting_manager_id to users
        try:
            await execute_query("SELECT reporting_manager_id FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN reporting_manager_id INT DEFAULT NULL")
                logger.info("Added reporting_manager_id to users")
            except Exception as e:
                logger.warning(f"Could not add reporting_manager_id: {e}")

        # Migration: Add assigned_manager columns to change_requests
        for col_def in ["assigned_manager_id INT DEFAULT NULL", "assigned_manager_name VARCHAR(255) DEFAULT NULL"]:
            col_name = col_def.split()[0]
            try:
                await execute_query(f"SELECT {col_name} FROM change_requests LIMIT 1", fetch_one=True)
            except Exception:
                try:
                    await execute_query(f"ALTER TABLE change_requests ADD COLUMN {col_def}")
                    logger.info(f"Added {col_name} to change_requests")
                except Exception as e:
                    logger.warning(f"Could not add {col_name} to change_requests: {e}")

        # Migration: Add is_cr_approver to users
        try:
            await execute_query("SELECT is_cr_approver FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN is_cr_approver TINYINT(1) DEFAULT 0")
                logger.info("Added is_cr_approver to users")
            except Exception as e:
                logger.warning(f"Could not add is_cr_approver: {e}")

        # Migration: Add date_of_birth to users
        try:
            await execute_query("SELECT date_of_birth FROM users LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE users ADD COLUMN date_of_birth VARCHAR(20) DEFAULT NULL")
                logger.info("Added date_of_birth to users")
            except Exception as e:
                logger.warning(f"Could not add date_of_birth: {e}")

        # Migration: Create salary_components table and seed defaults
        try:
            await execute_query("""
                CREATE TABLE IF NOT EXISTS salary_components (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    percentage FLOAT DEFAULT 0,
                    is_remainder TINYINT(1) DEFAULT 0,
                    sort_order INT DEFAULT 0
                )
            """)
            count = await execute_query("SELECT COUNT(*) as cnt FROM salary_components", fetch_one=True)
            if not count or count.get("cnt", 0) == 0:
                for comp in DEFAULT_SALARY_COMPONENTS:
                    await execute_query(
                        "INSERT INTO salary_components (name, percentage, is_remainder, sort_order) VALUES (%s, %s, %s, %s)",
                        (comp["name"], comp["percentage"], comp["is_remainder"], comp["sort_order"])
                    )
                logger.info("Seeded default salary components")
        except Exception as e:
            logger.warning(f"salary_components migration: {e}")

        # Migration: Add level_num to org_chart
        try:
            await execute_query("SELECT level_num FROM org_chart LIMIT 1", fetch_one=True)
        except Exception:
            try:
                await execute_query("ALTER TABLE org_chart ADD COLUMN level_num INT DEFAULT 0")
                logger.info("Added level_num to org_chart")
            except Exception as e:
                logger.warning(f"Could not add level_num to org_chart: {e}")

        # Backfill employee_code for existing users without one
        try:
            users_without_code = await execute_query("SELECT id FROM users WHERE employee_code IS NULL OR employee_code = '' ORDER BY id", fetch_all=True)
            if users_without_code:
                max_code = await execute_query("SELECT employee_code FROM users WHERE employee_code LIKE 'SC%' ORDER BY employee_code DESC LIMIT 1", fetch_one=True)
                next_num = 24001
                if max_code and max_code["employee_code"]:
                    try:
                        next_num = int(max_code["employee_code"][2:]) + 1
                    except ValueError:
                        pass
                for u in users_without_code:
                    code = f"SC{next_num}"
                    await execute_query("UPDATE users SET employee_code = %s WHERE id = %s", (code, u["id"]))
                    next_num += 1
                logger.info(f"Backfilled employee_code for {len(users_without_code)} users")
        except Exception as e:
            logger.warning(f"Employee code backfill skipped: {e}")

        # Seed admin
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@hrportal.com")
        admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")

        existing = await execute_query("SELECT id, password_hash FROM users WHERE email = %s", (admin_email,), fetch_one=True)
        if existing is None:
            hashed = hash_password(admin_password)
            try:
                await execute_query(
                    """INSERT INTO users (email, password_hash, name, role, department, position, avatar_url, created_at, casual_leave, sick_leave, loss_of_pay, employee_code)
                       VALUES (%s, %s, 'Admin', 'admin', 'Administration', 'System Admin', '', %s, 12, 3, 0, 'SC24001')""",
                    (admin_email, hashed, datetime.now(timezone.utc).isoformat())
                )
            except Exception:
                await execute_query(
                    """INSERT INTO users (email, password_hash, name, role, department, position, avatar_url, created_at, casual_leave, sick_leave, loss_of_pay)
                       VALUES (%s, %s, 'Admin', 'admin', 'Administration', 'System Admin', '', %s, 12, 3, 0)""",
                    (admin_email, hashed, datetime.now(timezone.utc).isoformat())
                )
            logger.info(f"Admin user created: {admin_email}")
        else:
            logger.info(f"Admin user exists: {admin_email}")

        # Verify admin can login
        admin_check = await execute_query("SELECT id, email, role FROM users WHERE email = %s AND role = 'admin'", (admin_email,), fetch_one=True)
        if admin_check:
            logger.info(f"Admin login ready - Email: {admin_email}")
        else:
            logger.error("CRITICAL: Admin user not found after seeding!")

        # Optional second superadmin, only when configured in .env
        hr_admins = []
        if os.environ.get("HR_ADMIN_EMAIL") and os.environ.get("HR_ADMIN_PASSWORD"):
            hr_admins.append({"email": os.environ["HR_ADMIN_EMAIL"], "password": os.environ["HR_ADMIN_PASSWORD"], "name": "HR Admin", "code": "SC24002"})
        for ha in hr_admins:
            ex = await execute_query("SELECT id, password_hash FROM users WHERE email = %s", (ha["email"],), fetch_one=True)
            if ex is None:
                hashed2 = hash_password(ha["password"])
                try:
                    await execute_query(
                        """INSERT INTO users (email, password_hash, name, role, department, position, avatar_url, created_at, casual_leave, sick_leave, loss_of_pay, employee_code)
                           VALUES (%s, %s, %s, 'admin', 'Administration', 'HR Admin', '', %s, 12, 3, 0, %s)""",
                        (ha["email"], hashed2, ha["name"], datetime.now(timezone.utc).isoformat(), ha["code"])
                    )
                    logger.info(f"HR Admin created: {ha['email']}")
                except Exception as e2:
                    logger.warning(f"HR Admin seed fallback: {e2}")
                    await execute_query(
                        """INSERT INTO users (email, password_hash, name, role, department, position, avatar_url, created_at, casual_leave, sick_leave, loss_of_pay)
                           VALUES (%s, %s, %s, 'admin', 'Administration', 'HR Admin', '', %s, 12, 3, 0)""",
                        (ha["email"], hashed2, ha["name"], datetime.now(timezone.utc).isoformat())
                    )
            else:
                logger.info(f"HR Admin exists: {ha['email']}")

        # Migration: images saved by older versions as files under /uploads/... are never served;
        # move them into the media table (like current uploads) or clear the link if the file is gone
        for table, column, api_prefix in (("users", "avatar_url", "/api/admin/avatars/"), ("org_chart", "image_url", "/api/admin/avatars/")):
            try:
                legacy = await execute_query(f"SELECT id, {column} AS url FROM {table} WHERE {column} LIKE '/uploads/%%'", fetch_all=True)
                for row in (legacy or []):
                    path = (ROOT_DIR / row["url"].lstrip("/")).resolve()
                    new_url = ""
                    if path.is_file() and ROOT_DIR.resolve() in path.parents:
                        media_id = await _save_image_db(path.read_bytes(), path.name)
                        new_url = f"{api_prefix}{media_id}"
                    await execute_query(f"UPDATE {table} SET {column} = %s WHERE id = %s", (new_url, row["id"]))
                    logger.info(f"Migrated legacy image for {table} #{row['id']}: {row['url']} -> {new_url or '(cleared, file missing)'}")
            except Exception as e:
                logger.warning(f"Legacy image migration skipped for {table}: {e}")

        # Seed the holiday list once (afterwards admins manage it in the app)
        holiday_count = await execute_query("SELECT COUNT(*) as cnt FROM holidays", fetch_one=True)
        if holiday_count and holiday_count["cnt"] == 0:
            now = datetime.now(timezone.utc).isoformat()
            for h in DEFAULT_HOLIDAYS:
                await execute_query(
                    "INSERT IGNORE INTO holidays (date, festival, created_at, updated_at) VALUES (%s, %s, %s, %s)",
                    (h["date"], h["festival"], now, now)
                )
            logger.info(f"Seeded {len(DEFAULT_HOLIDAYS)} default holidays")

        # Seed default policies if none exist
        policy_count = await execute_query("SELECT COUNT(*) as cnt FROM policies", fetch_one=True)
        if policy_count and policy_count["cnt"] == 0:
            now = datetime.now(timezone.utc).isoformat()
            default_policies = [
                ("Leave Policy", "Leave", "Casual Leave: 12 days per year\nSick Leave: 3 days per year\nLoss of Pay (LOP): Available when paid leaves are exhausted. Salary will be deducted proportionally for each LOP day taken.\n\nLeave requests must be submitted in advance and approved by your Manager or Admin. Weekends (Saturday & Sunday) and public holidays are excluded from leave day calculations.", "calendar", 1),
                ("Working Hours", "Attendance", "Working day: 8 hours from Login to Logout\nPauses (travel/away) are not counted toward the 8 hours\n\nEmployees who log out before completing 8 hours will be marked as a 'Short Day'. Every 3 short days will result in an automatic deduction of 0.5 day casual leave.", "clock", 2),
                ("Shift Timings", "Shift", "General Shift: 09:30 AM - 05:30 PM\nMorning Shift: 04:00 AM - 12:00 PM\nAfternoon Shift: 12:00 PM - 08:00 PM\nNight Shift: 08:00 PM - 04:00 AM\n\nShift assignments are managed by the Admin. Once assigned, shift changes require Admin approval.", "moon", 4),
                ("Permission Hours", "Permission", "Monthly allowance: 2 hours\nMaximum per use: 1 hour\n\nPermission requests must be submitted with a valid reason. Unused permission hours do not carry forward to the next month.", "hourglass", 5),
                ("Holiday Policy", "Holiday", "The company observes 12 public holidays per year.\nSaturday and Sunday are weekly holidays for all employees.\n\nEmployees cannot clock in on weekends or public holidays. The complete holiday list is available in the Holidays tab.", "flag", 6),
                ("Payslip", "Payroll", "Payslips are generated monthly by the Admin.\nDeductions include: Half-day deductions for short working days, Loss of Pay deductions.\n\nEmployees can download their payslips in PDF format from the Payslips section.", "receipt", 7),
            ]
            for title, category, content, icon, order in default_policies:
                await execute_query(
                    "INSERT INTO policies (title, category, content, icon, sort_order, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (title, category, content, icon, order, now, now)
                )
            logger.info("Default company policies seeded")

        await email_settings.load()
        email_settings.start_refresh()
        await client_mgmt_schema.upgrade()   # revision client_mgmt_001 (idempotent)
        start_month_end_scheduler()
        start_cm_reminder_scheduler()
        asyncio.create_task(_payslip_scheduler_loop())
        start_reminder_scheduler()
        logger.info("Payslip auto-generation scheduler started (runs daily, generates previous month's payslips on/after the 1st)")

    except Exception as e:
        logger.error(f"STARTUP ERROR: {str(e)}")
        logger.error(traceback.format_exc())
        logger.error("Make sure MySQL is running and .env has correct MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB")
