# Sparkcurv HR Portal — PRD

## Original Problem Statement
Build an HR portal for all employees with Leave, Login, logout, break etc., frontend dashboard for admin and employee login, and backend in Python.

## Product Requirements
- 3-tier roles: Admin, Manager, Employee
- Attendance & hours tracking (8 hours/day minimum, 40 min allowed break)
- Leave logic (Casual, Sick, Half-day support)
- WFH limits/requests
- Custom PDF Payslips
- Shift management + Employee IDs
- Payroll system (custom deductions)
- Change Request (CR) system with 2-step approval (Manager → Admin) + auto-apply
- Geofenced GPS Location Tracking (maps & geocoding via Nominatim + Leaflet)
- Push/Polling Notifications
- Attendance Heatmaps (4-week view, on-time vs late)
- Break Location Alert badge
- Admin Leave Balance Editor (per-employee)
- Worker Org Tree with images
- Role-based Tab Access Control (Manager/Employee tabs togglable by Admin)

## Tech Stack
- **Frontend**: React, Tailwind CSS, Shadcn UI, Leaflet (react-leaflet), @phosphor-icons/react
- **Backend**: FastAPI, Python, JWT Auth
- **Database**: MySQL/MariaDB via `aiomysql` (raw SQL, no ORM)
- **Fonts**: Outfit (headings), Manrope (body), JetBrains Mono (timers)
- **Brand Color**: #002FA7 (deep royal blue)

## Code Architecture
```
/app/
├── backend/
│   ├── server.py              # All routes (~3100 lines, needs future refactor)
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── index.css          # Design system + component classes
│   │   ├── contexts/AuthContext.jsx
│   │   ├── contexts/ThemeContext.jsx
│   │   ├── components/
│   │   │   ├── CRApproveDialog.jsx   # CR Admin approve dialog (extracted)
│   │   │   └── OrgTreeNode.jsx       # Org tree rendering (extracted)
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── EmployeeDashboard.jsx
│   │       └── AdminDashboard.jsx
├── database_setup.sql
└── setup.sh
```

## Key DB Schema
- `users`: {id, employee_code, name, email, role, department, basic_salary, shift, casual_leave, sick_leave, loss_of_pay, permission_hours, wfh_limit}
- `attendance`: {id, user_id, clock_in, clock_out, latitude, longitude, address, break_outside_geofence, working_hours}
- `breaks`: {id, attendance_id, start/end lat/lng, start/end address}
- `leave_requests`: {id, user_id, leave_type, start_date, end_date, is_half_day, status}
- `change_requests`: {id, requester_id, title, description, cr_type, status, manager_approval, admin_approval, metadata, applied_changes}
- `payslips`: {id, user_id, month, year, basic_salary, total_deductions, net_pay}
- `office_settings`: {id, latitude, longitude, radius_km, name}
- `org_chart`: {id, parent_id, employee_name, job_title, image_url, description, sort_order, **level_num**}
- `org_levels`: {id, level_num, label} — maps numeric levels to custom admin-defined names (L1=CEO, L2=Director, etc.)
- `role_permissions`: {id, role, feature_key, enabled}

## What's Been Implemented

### 2025-2026 (all sessions)
- ✅ Email/Password JWT Auth, Role-based routing (Admin/Manager/Employee)
- ✅ Attendance: Clock In/Out, Break, "Short Day" logic (< 8h), 40-min break limit
- ✅ Leave Management: Casual/Sick/Half-day, Admin approval, leave balance deduction
- ✅ WFH requests with approval
- ✅ Permission requests (2h/month limit, max 1h per use)
- ✅ Payroll: Salary setup, Custom deductions, Bulk processing, PDF payslips
- ✅ Change Request (CR) system — 2-step approval flow (Manager → Admin)
- ✅ GPS Geofenced Attendance — mandatory location capture, Nominatim geocoding
- ✅ Interactive Leaflet Map — Admin attendance map view with geofence circle
- ✅ Attendance Heatmap — 4-week overview (on-time/late/absent)
- ✅ Break Location Alert — badge in admin attendance table
- ✅ Polling Notifications — bell with badge for pending approvals
- ✅ Company Policy CRUD
- ✅ Holiday list
- ✅ Admin: Employee management (add/edit/delete/assign shift/set salary/reset password/upload avatar)
- ✅ **GUI Redesign** (Feb 2026): Rebranded Sparkcurve → Sparkcurv
- ✅ **Dark Mode Toggle** (Feb 2026): Full dark/light mode toggle, persisted in localStorage
- ✅ **Leave Balance Editor** (Feb 2026): Admin can edit casual/sick/LOP/permission/WFH per employee
- ✅ **Worker Org Tree** (Feb 2026): Visual hierarchy with images
- ✅ **Role-Based Tab Access** (Feb 2026): Admin toggles which tabs Manager/Employee can see
- ✅ **CR Auto-Apply** (Feb 2026): On admin approval, Salary/Leave/Shift changes auto-apply to DB
- ✅ **Employee ID (employee_code)** (Aug 2026): SC24001 series, auto-gen with manual override
- ✅ **HQ Location → Nagercoil** (Aug 2026): `office_settings` updated to 8.1815, 77.4294
- ✅ **Geofence Bypass Mode** (Aug 2026): Admin toggle to allow clock-in from any location; `geofence_bypass` column in `office_settings`
- ✅ **Auto Detect Location** (Aug 2026): Admin opens Office Settings → clicks "Auto Detect My Current Location" → browser GPS fills lat/lng + reverse geocoded address
- ✅ **GPS Status Panel** (Aug 2026): Employee dashboard shows live distance from office + within/outside geofence indicator before clicking Clock In
- ✅ **GPS Tracking Per-Employee Toggle** (Aug 2026): Admin can enable/disable GPS tracking per employee from the Employees table. Green WiFi icon = ON, gray = OFF. When disabled: employee can clock in from anywhere without GPS check. Employee dashboard shows "GPS tracking disabled by admin" badge. New column: `users.gps_tracking_enabled` (TINYINT 1, default 1)

## What's Been Done (Recent)

### Sep 2026
- ✅ **CR Email Notifications (Gmail SMTP)**: On CR submit, sends HTML notification emails to all managers + admins. Email shows CR ID, Title, Description, Priority, Type, and has Approve/Reject buttons.
- ✅ **Unique CR Number**: Auto-generated `CR-YYYY-NNNN` format (e.g. `CR-2026-0001`). Existing rows backfilled.
- ✅ **Token-based Review Page**: Managers/Admins receive email with signed link → opens browser-based review page (no app login needed). Reviewer can add notes and confirm approve/reject.
- ✅ **Manager → Admin Email Chain**: After manager approves, a new email is automatically sent to all admins for final approval.
- ✅ **Reporting Manager field**: Added `reporting_manager_id` to users table + Admin Employee edit form includes a Reporting Manager dropdown.
- ✅ **DevOps Manager role**: New `devops_manager` role with same access as Manager. Available in create/edit employee dropdowns. Shown with purple badge.
- ✅ **Gmail credentials placeholder**: Add `GMAIL_USER` and `GMAIL_APP_PASSWORD` to `/app/backend/.env` to activate email sending.
- ✅ **GPS Bypass for GPS-disabled employees**: Fixed `clock-out`, `break/start`, `break/end` backend endpoints
- ✅ **Frontend GPS fix**: `checkGPSStatus()` auto-call on load now skipped when GPS is disabled for the employee; break handlers (start/end) also respect GPS disable toggle
- ✅ **Unified Timer Card**: Flexible Timer merged inside the Time Tracker card as a single container — controlled by `timer_access_enabled` admin toggle. Old standalone `lg:col-span-12` flexible timer card removed.
- ✅ **CR Approver Toggle**: Admin can toggle `is_cr_approver` for any employee via the `...` dropdown in Employee table. Only CR approvers appear in the CR submission Manager dropdown.
- ✅ **Sabarish & Merbin accounts**: Created as managers with `is_cr_approver = true`.
- ✅ **Configurable Salary Components**: `salary_components` table with default 5 components (Basic 50%, HRA 20%, Medical 4.5%, Conveyance 6%, Special Allowance remainder). Admin can edit via Payroll > Salary Structure tab.
- ✅ **Payslip Filters**: Employee, Month, Year filter dropdowns in Payroll > Payslips tab.
- ✅ **Email Payslip**: "Email" button on each payslip row sends PDF attachment to employee via Gmail SMTP.
- ✅ **Payslip PDF uses DB components**: PDF earnings breakdown now reads from `salary_components` table instead of hardcoded values.

### Sep 2026 (cont.)
- ✅ **Environment recovery**: MariaDB was missing from the container (fresh pod had no mariadb-server installed, no `backend/.env`/`frontend/.env`, and `/app/mysql-data` was corrupted — missing `ib_logfile0`). Installed `mariadb-server`, added a `[program:mariadb]` supervisor block running `/app/start_mysql.sh`, reinitialized `/app/mysql-data` fresh, ran `database_setup.sql`, and recreated `backend/.env` (MYSQL_*, JWT_SECRET, ADMIN_EMAIL/PASSWORD, FRONTEND_URL, BACKEND_URL) + `frontend/.env` (REACT_APP_BACKEND_URL). Backend auto-migrated all tables/columns on startup and re-seeded admin (`admin@hrportal.com` / `Admin@123`) and default policies. Old corrupted data backed up at `/app/mysql-data-old-corrupt`.
- ✅ **Manager Clock In/Out/Break**: Extracted the Employee "Time Tracker" widget into a shared component `frontend/src/components/TimeTrackerCard.jsx` (self-contained: fetches `/attendance/status`, `/attendance/my-shift`, `/attendance/timer/today`; handles clock-in/out, break start/end, GPS check, flexible timer). Added new sidebar tab "My Attendance" (`managerOnly`, visible only to `manager`/`devops_manager`, not togglable via Role Access) in `AdminDashboard.jsx` that renders `<TimeTrackerCard />`. No backend changes needed — attendance endpoints were already role-agnostic (keyed by `user_id`), so Manager attendance is stored in the same `attendance`/`breaks` tables and shows up in Admin's Attendance tab, Heatmap, and reports exactly like Employees. Verified end-to-end via curl (clock-in → break start/end → clock-out → visible in `/api/admin/attendance`) and screenshot of the new "My Attendance" tab.

### Sep 2026 (cont. 2)
- ✅ **Pause/Travel option (Employee + Manager)**: New `pauses` table + `/api/attendance/pause/start` and `/pause/end` endpoints. Unlimited pauses/day, fully excluded from the 8h requirement (unlike Break which only deducts time beyond 40 min). Mutually exclusive with Break (can't pause while on break and vice versa, enforced backend + UI). `TimeTrackerCard.jsx` now shows Pause/Resume button next to Break, disables Clock Out while paused or on break.
- ✅ **Compulsory 8h before Clock Out**: `/attendance/clock-out` now HARD BLOCKS (400 error) if `working_hours < 8` (excluding break excess + full pause time), instead of the old "short day" flag. Applies to both Employee and Manager.
- ✅ **DRY refactor**: `EmployeeDashboard.jsx`'s inline Time Tracker widget (GPS, clock in/out, break, flexible timer — ~250 lines of state/handlers) replaced with `<TimeTrackerCard />`, same shared component used by Manager. Single source of truth for attendance logic now.
- ✅ **Employee Birthdays / Calendar**: Added `date_of_birth` column to `users`, Date of Birth field in Admin's Add/Edit Employee dialogs, new `GET /api/birthdays/list` endpoint (sorted by days-until-next-birthday), and a new `BirthdayWidget.jsx` (Upcoming Birthdays list + month calendar with birthday dates highlighted) embedded in the "Calendar & Holidays" tab for Employee, Manager and Admin.
- ✅ **Environment note**: Confirmed correct public URL is `https://attendance-hub-1369.preview.emergentagent.com` (not the `APP_URL` value baked into supervisor's backend env block, which was stale/mismatched). `frontend/.env` REACT_APP_BACKEND_URL and `backend/.env` FRONTEND_URL/BACKEND_URL corrected to this value.

### Sep 2026 (cont. 3)
- ✅ **CR visibility restricted to Reporting Manager**: Employees no longer pick a manager from a dropdown — CR is auto-routed to their `reporting_manager_id` (set by Admin). New `GET /cr/my-manager` endpoint powers a read-only "Reporting Manager" card in the CR submission form. Backend enforces 403 if a manager tries to act on a CR not assigned to them (`assigned_manager_id != user.id`). Verified: Manager1 (reporting mgr) sees 1 CR, Manager2 sees 0, Admin sees all.
- ✅ **Removed email Approve/Reject links entirely**: Deleted `_sign_review_token`, `_verify_review_token`, `/cr/review/{token}` GET+POST routes and all review-page HTML helpers. `_cr_email_html` is now a notify-only template ("Login to Portal" CTA, no action buttons) — approval only possible after logging into the portal.
- ✅ **Manager Notes on CR**: Added a small Notes dialog (`crManagerDialogOpen`) in Admin/Manager dashboard so Manager can type notes before Approve/Reject (previously `crActionNotes` state existed but had no input, always sent empty). Notes stored in `manager_notes`, visible to Admin in the CR table and via portal email notification trigger sent to Admin on manager-approve.
- ✅ **Overview widgets — Birthdays / Work Anniversaries / Onboarding**: New `GET /api/team-events` endpoint (30-day window) + `TeamEventsWidget.jsx` (3-column card) embedded in both Employee Dashboard and Admin/Manager Overview tabs.

### Sep 2026 (cont. 4)
- ✅ **Income & Expense module (Admin only)**: New `finance_entries` + `finance_categories` tables. Preset categories seeded (Salary, Rent, Utilities, Office Supplies, Travel, Marketing, Software/Subscriptions, Misc Expense, Sales, Service Revenue, Investment, Misc Income) + Admin can add custom ones. Entries support Date/Type/Category/Amount/Description + optional Receipt (image or PDF, stored as BLOB in `media` table, max 8MB). New tab "Income & Expense" (`adminOnly`) in Admin sidebar with Summary cards (Total Income/Expense/Net Balance), month filter, Add/Edit/Delete entries, "+ Category" dialog. All `/api/finance/*` endpoints gated by `require_admin` — verified Manager gets 403.
- ✅ **Environment note**: MariaDB package + supervisor `[program:mariadb]` block get wiped on container/pod restarts (ephemeral OS layer) — only `/app` and `/etc/supervisor/conf.d` persist. If backend can't connect to MySQL after a restart, re-run `apt-get install -y mariadb-server` and `supervisorctl start mariadb` (data in `/app/mysql-data` itself persists fine).

## Pending Items (Prioritized)

### P1 - High  
- [ ] **Refactor server.py** into `/app/backend/routes/` modules (auth, employees, attendance, leaves, payroll, change_requests, admin)

### P2 - Medium
- [ ] **Accessibility improvements** (aria attributes) across dashboards

## Key API Endpoints
- Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Attendance: `POST /api/attendance/clock-in`, `POST /api/attendance/clock-out`, `POST /api/attendance/break`, `POST /api/attendance/check-location`
- Leaves: `GET/POST /api/leaves`, `PUT /api/admin/leaves/{id}`
- Leave Balance: `GET/PUT /api/admin/employees/{id}/leave-balance`
- Payroll: `GET /api/admin/payroll/summary`, `POST /api/admin/payroll/process`, `POST /api/admin/payslip/generate`, `GET/PUT /api/admin/salary-components`, `POST /api/admin/payslips/{id}/email`
- Change Requests: `GET/POST /api/cr`, `POST /api/cr/create`, `GET /api/cr/managers`, `PUT /api/admin/cr/{id}/manager-action`, `PUT /api/admin/cr/{id}/admin-action`
- CR Approver: `PUT /api/admin/employees/{id}/cr-approver`
- Org Chart: `GET/POST/PUT/DELETE /api/admin/org-chart`
- Role Perms: `GET/PUT /api/admin/role-permissions`, `GET /api/my-permissions`
- Office: `GET/PUT /api/admin/office-settings` (supports `geofence_bypass` field)
- Notifications: `GET /api/admin/notifications`
- Heatmap: `GET /api/admin/attendance/heatmap`
