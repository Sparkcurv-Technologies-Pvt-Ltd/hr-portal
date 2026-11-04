"""Client Management tests (Phase 1: backend).

These run the app in-process (FastAPI TestClient), need no running server, and use the local development database from backend/.env
(the DB user only has rights on that one schema). Everything created is tagged ``zzcm`` and removed afterwards; the migration test works
on prefixed copies (``zzmig_``) of the tables and never touches real ones. Emails are captured, never sent.

Run:  cd backend && venv/bin/python -m pytest tests/test_client_mgmt.py -v
"""

import io
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from fastapi.testclient import TestClient  # noqa: E402

import app.core.email as email_core  # noqa: E402
import app.services.cm_sales as cm_sales  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db import execute_query  # noqa: E402
from app.services import client_mgmt_schema as schema  # noqa: E402
from server import app  # noqa: E402

PASSWORD = "Pw12345!"
TAG = "zzcm"
R = "/api/client-mgmt"
PUB = "/api/public/proposals"
PDF_EMAILS, PLAIN_EMAILS = [], []        # what the code tried to send (nothing is actually sent)
_n = [0]


# ---------------------------------------------------------------- fixtures / helpers

@pytest.fixture(scope="module")
def client():
    email_core._send_email = lambda *a, **k: None
    cm_sales._send_email = lambda to, subject, html, category=None: PLAIN_EMAILS.append((to, subject, html, category))
    cm_sales._send_email_with_pdf = lambda to, subject, html, pdf, filename, category=None: PDF_EMAILS.append((to, subject, html, pdf.getvalue(), filename, category))
    with TestClient(app) as c:
        yield c
        _cleanup(c)

def db(c, sql, args=(), **kw):
    return c.portal.call(lambda: execute_query(sql, args, **kw))

def _cleanup(c):
    users = [r["id"] for r in db(c, f"SELECT id FROM users WHERE email LIKE '{TAG}-%%@example.com'", fetch_all=True) or []]
    um = ", ".join(["%s"] * len(users)) or "NULL"
    clients = [r["id"] for r in db(c, f"SELECT id FROM clients WHERE name LIKE '%%{TAG.upper()}%%'", fetch_all=True) or []]
    cm = ", ".join(["%s"] * len(clients)) or "NULL"
    leads = [r["id"] for r in db(c, f"SELECT id FROM leads WHERE created_by IN ({um}) OR owner_id IN ({um}) OR client_id IN ({cm}) OR company_name LIKE '%%{TAG.upper()}%%'", tuple(users) * 2 + tuple(clients), fetch_all=True) or []]
    lm = ", ".join(["%s"] * len(leads)) or "NULL"
    props = [r["id"] for r in db(c, f"SELECT id FROM proposals WHERE lead_id IN ({lm}) OR client_id IN ({cm})", tuple(leads) + tuple(clients), fetch_all=True) or []]
    pm = ", ".join(["%s"] * len(props)) or "NULL"
    invs = [r["id"] for r in db(c, f"SELECT id FROM invoices WHERE client_id IN ({cm})", tuple(clients), fetch_all=True) or []]
    im = ", ".join(["%s"] * len(invs)) or "NULL"
    pays = [r["id"] for r in db(c, f"SELECT id FROM client_payments WHERE client_id IN ({cm})", tuple(clients), fetch_all=True) or []]
    ym = ", ".join(["%s"] * len(pays)) or "NULL"
    advs = [r["id"] for r in db(c, f"SELECT id FROM client_advances WHERE client_id IN ({cm})", tuple(clients), fetch_all=True) or []]
    am = ", ".join(["%s"] * len(advs)) or "NULL"
    db(c, f"DELETE FROM payment_allocations WHERE payment_id IN ({ym}) OR invoice_id IN ({im})", tuple(pays) + tuple(invs))
    db(c, f"DELETE FROM advance_adjustments WHERE advance_id IN ({am}) OR invoice_id IN ({im})", tuple(advs) + tuple(invs))
    for table, ids, col in (("client_payments", pays, "id"), ("client_advances", advs, "id"), ("invoices", invs, "id")):
        if ids:
            db(c, f"DELETE FROM {table} WHERE {col} IN ({', '.join(['%s'] * len(ids))})", tuple(ids))
    cids = [r["id"] for r in db(c, f"SELECT id FROM contracts WHERE client_id IN ({cm}) OR proposal_id IN ({pm})", tuple(clients) + tuple(props), fetch_all=True) or []]
    if cids:
        db(c, f"DELETE FROM contract_files WHERE contract_id IN ({', '.join(['%s'] * len(cids))})", tuple(cids))
    db(c, f"DELETE FROM reminder_log WHERE user_id IN ({um})", tuple(users))
    fus = [r["id"] for r in db(c, f"SELECT id FROM followups WHERE client_id IN ({cm}) OR company_name LIKE '%%ZZCM%%' OR owner_id IN ({um})", tuple(clients) + tuple(users), fetch_all=True) or []]
    if fus:
        fm = ", ".join(["%s"] * len(fus))
        db(c, f"DELETE FROM followup_steps WHERE followup_id IN ({fm})", tuple(fus))
        db(c, f"DELETE FROM followups WHERE id IN ({fm})", tuple(fus))
    db(c, f"DELETE FROM activity_log WHERE client_id IN ({cm}) OR company_name LIKE '%%ZZCM%%' OR created_by IN ({um}) OR owner_id IN ({um})", tuple(clients) + tuple(users) * 2)
    db(c, f"DELETE FROM contracts WHERE client_id IN ({cm}) OR proposal_id IN ({pm})", tuple(clients) + tuple(props))
    db(c, f"DELETE FROM projects WHERE client_id IN ({cm}) OR name LIKE '{TAG.upper()}%%'", tuple(clients))
    db(c, f"DELETE FROM proposal_items WHERE proposal_id IN ({pm})", tuple(props))
    db(c, f"DELETE FROM proposal_files WHERE proposal_id IN ({pm})", tuple(props))
    db(c, f"DELETE FROM proposals WHERE id IN ({pm})", tuple(props))
    db(c, f"DELETE FROM tenders WHERE lead_id IN ({lm})", tuple(leads))
    db(c, f"DELETE FROM lead_activities WHERE lead_id IN ({lm})", tuple(leads))
    db(c, f"DELETE FROM opportunities WHERE client_id IN ({cm}) OR created_by IN ({um}) OR owner_id IN ({um}) OR lead_id IN ({lm})", tuple(clients) + tuple(users) * 2 + tuple(leads))
    db(c, f"DELETE FROM leads WHERE id IN ({lm})", tuple(leads))
    db(c, f"DELETE FROM clients WHERE id IN ({cm})", tuple(clients))
    db(c, f"DELETE FROM user_permissions WHERE user_id IN ({um})", tuple(users))
    db(c, f"DELETE FROM users WHERE email LIKE '{TAG}-%%@example.com'")
    for uid in _CREATED_SUPERADMIN:
        db(c, "DELETE FROM users WHERE id = %s", (uid,))

_CREATED_SUPERADMIN = []

def _superadmin_id(c):
    """Management access only counts when a superadmin granted it, so the tests grant as one (created here if this database has none)."""
    from app.core.config import SUPERADMIN_EMAILS
    email = sorted(SUPERADMIN_EMAILS)[0]
    row = db(c, "SELECT id FROM users WHERE role = 'admin' AND LOWER(email) = %s", (email,), fetch_one=True)
    if row:
        return row["id"]
    uid = db(c, "INSERT INTO users (email, password_hash, name, role, department, position, created_at) VALUES (%s, %s, %s, 'admin', 'QA', 'Tester', %s)",
             (email, hash_password(PASSWORD), "ZZCM superadmin", datetime.now(timezone.utc).isoformat()), last_id=True)
    _CREATED_SUPERADMIN.append(uid)
    return uid

def _mk_user(c, name, role="employee", grants=None):
    """grants: {"sales": (view, edit, delete), "accounts": (...)}. Grants only count when a superadmin made them."""
    uid = db(c, "INSERT INTO users (email, password_hash, name, role, department, position, created_at) VALUES (%s, %s, %s, %s, 'QA', 'Tester', %s)",
             (f"{TAG}-{name}@example.com", hash_password(PASSWORD), f"ZZCM {name}", role, datetime.now(timezone.utc).isoformat()), last_id=True)
    admin = _superadmin_id(c)
    for module, (v, e, d) in (grants or {}).items():
        db(c, "INSERT INTO user_permissions (user_id, module, can_view, can_edit, can_delete, granted_by) VALUES (%s, %s, %s, %s, %s, %s)", (uid, module, v, e, d, admin))
    return {"id": uid, "email": f"{TAG}-{name}@example.com", "name": f"ZZCM {name}"}

@pytest.fixture(scope="module")
def people(client):
    c = client
    return {
        "admin": _mk_user(c, "admin", role="admin"),
        "sales_a": _mk_user(c, "sales-a", "manager", {"sales": (1, 1, 0)}),
        "sales_b": _mk_user(c, "sales-b", "manager", {"sales": (1, 1, 0)}),
        "mgr": _mk_user(c, "mgr", "manager", {"sales": (1, 1, 1)}),
        "sales_view": _mk_user(c, "sales-view", "manager", {"sales": (1, 0, 0)}),
        "acct": _mk_user(c, "acct", "manager", {"accounts": (1, 1, 0)}),
        "acct_view": _mk_user(c, "acct-view", "manager", {"accounts": (1, 0, 0)}),
        "plain": _mk_user(c, "plain"),
        "plain_mgr": _mk_user(c, "plain-mgr", "manager"),
    }

def as_(c, user):
    c.cookies.clear()
    r = c.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c

def wait_for(predicate, seconds=3.0):
    """Emails are sent from a worker thread; give it a moment."""
    import time
    end = time.time() + seconds
    while time.time() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()

def uniq():
    _n[0] += 1
    return f"{os.getpid() % 1000}{int(datetime.now().timestamp()) % 100000}{_n[0]}"

def new_client(c, who, **extra):
    as_(c, who)
    r = c.post(f"{R}/clients", json={"name": f"ZZCM Client {uniq()}", "gstin": f"29ZZCM{uniq()}"[:15], "contact_person": "Asha", "phone": "9000011111", "email": f"{TAG}-c-{uniq()}@example.com",
                                      "default_tds_pct": 2, "default_retention_pct": 5, **extra})
    assert r.status_code == 200, r.text
    return r.json()

def new_lead(c, who, **extra):
    as_(c, who)
    u = uniq()
    body = {"source": "Referral", "company_name": f"ZZCM Lead Co {u}", "contact_person": "Ravi", "phone": f"9{u.zfill(9)[-9:]}", "email": f"{TAG}-lead-{u}@example.com", "location": "Chennai", **extra}
    r = c.post(f"{R}/leads", json=body)
    assert r.status_code == 200, r.text
    return r.json()

ITEM = {"description": "Consulting", "quantity": 10, "unit": "days", "rate": 1000, "cost": 600}     # total 10,000, cost 6,000

def qualified_lead(c, who, **lead_extra):
    """A lead converted to an opportunity (its account is created); returns the opportunity. The account gets the usual TDS / retention defaults the invoices pick up."""
    lead = new_lead(c, who, **lead_extra)
    as_(c, who)
    r = c.post(f"{R}/leads/{lead['id']}/convert", json={"deal_value": 365000})
    assert r.status_code == 200, r.text
    opp = r.json()["opportunity"]
    assert c.put(f"{R}/clients/{opp['client_id']}", json={"default_tds_pct": 2, "default_retention_pct": 5}).status_code == 200
    return opp

def new_proposal(c, who, opp, items=None, **extra):
    as_(c, who)
    r = c.post(f"{R}/opportunities/{opp['id']}/proposals", json={"title": f"ZZCM Proposal {uniq()}", "terms": "Net 30", "items": items if items is not None else [ITEM], **extra})
    assert r.status_code == 200, r.text
    return r.json()

def send(c, who, pid, **extra):
    as_(c, who)
    return c.post(f"{R}/proposals/{pid}/send", json={"to": f"{TAG}-client-{uniq()}@example.com", **extra})

def approve(c, mgr, pid, status="APPROVED", note=""):
    as_(c, mgr)
    return c.post(f"{R}/proposals/{pid}/review", json={"status": status, "note": note})

def approved_proposal(c, people, items=None):
    lead = qualified_lead(c, people["sales_a"])
    prop = new_proposal(c, people["sales_a"], lead, items)
    assert send(c, people["sales_a"], prop["id"]).status_code == 200
    assert approve(c, people["mgr"], prop["id"]).status_code == 200
    return lead, prop

PO = {"po_reference": "PO-7788", "po_date": "2026-01-01", "contract_no": "CN-1", "start_date": "2026-01-01", "end_date": "2026-12-31", "contract_value": 365000}

def booked_contract(c, people, **po):
    lead, prop = approved_proposal(c, people)
    as_(c, people["mgr"])
    r = c.post(f"{R}/proposals/{prop['id']}/book-po", json={**PO, **po})
    assert r.status_code == 200, r.text
    return lead, prop, r.json()

def active_contract(c, people, **po):
    lead, prop, k = booked_contract(c, people, **po)
    as_(c, people["mgr"])
    r = c.post(f"{R}/contracts/{k['id']}/engagement", json={})
    assert r.status_code == 200, r.text
    return lead, prop, r.json()

def posted_invoice(c, people, contract, period, **kw):
    as_(c, people["acct"])
    inv = c.post(f"{R}/invoices", json={"contract_id": contract["id"], "period": period, **kw})
    assert inv.status_code == 200, inv.text
    r = c.post(f"{R}/invoices/{inv.json()['id']}/post")
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- migration

def test_migration_upgrade_downgrade_upgrade_is_clean_on_empty_tables(client):
    """Empty prefixed copies (the DB user can't create a second database): upgrade, upgrade again, downgrade, upgrade — columns and back-fill included."""
    c, p = client, "zzmig_"
    expected = sorted(f"{p}{t}" for t in [*schema.TABLES, *schema.BASE_TABLES, "schema_revisions"])
    run = lambda coro: c.portal.call(lambda: coro)   # noqa: E731
    real_leads = db(c, "SELECT COUNT(*) AS n FROM leads", fetch_one=True)["n"]
    real_client_cols = [r["Field"] for r in db(c, "SHOW COLUMNS FROM clients", fetch_all=True)]
    run(schema.downgrade(p))
    assert run(schema.table_names(p)) == [] and run(schema.current_revision(p)) == "baseline"

    run(schema.upgrade(p))
    assert run(schema.table_names(p)) == expected
    assert run(schema.current_revision(p)) == schema.REVISION == "client_mgmt_002"
    cols = {r["Field"] for r in db(c, f"SHOW COLUMNS FROM {p}clients", fetch_all=True)}
    assert {"code", "gstin", "billing_address", "contact_person", "default_tds_pct", "default_retention_pct"} <= cols
    assert {"client_id", "contract_id"} <= {r["Field"] for r in db(c, f"SHOW COLUMNS FROM {p}projects", fetch_all=True)}
    run(schema.upgrade(p))                                                         # idempotent
    assert run(schema.table_names(p)) == expected and db(c, f"SELECT COUNT(*) AS n FROM {p}schema_revisions", fetch_one=True)["n"] == 2

    db(c, f"INSERT INTO {p}clients (name, status, created_at) VALUES ('probe', 'active', 'now')")
    run(schema.downgrade(p))
    assert run(schema.table_names(p)) == [] and run(schema.current_revision(p)) == "baseline"

    # an existing client table without the new columns is extended and its rows get codes
    db(c, f"CREATE TABLE {p}clients (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200) NOT NULL, email VARCHAR(255) DEFAULT '', phone VARCHAR(50) DEFAULT '', address TEXT, notes TEXT, status VARCHAR(20) DEFAULT 'active', created_at VARCHAR(64), UNIQUE KEY uk_client_name (name))")
    db(c, f"INSERT INTO {p}clients (name, status, created_at) VALUES ('legacy client', 'active', 'now')")
    run(schema.upgrade(p))
    row = db(c, f"SELECT code, default_tds_pct FROM {p}clients WHERE name = 'legacy client'", fetch_one=True)
    assert row["code"].startswith("CLI-") and float(row["default_tds_pct"]) == 0
    assert db(c, f"SELECT COUNT(*) AS n FROM {p}leads", fetch_one=True)["n"] == 0
    run(schema.downgrade(p))
    assert run(schema.table_names(p)) == []
    assert db(c, "SELECT COUNT(*) AS n FROM leads", fetch_one=True)["n"] == real_leads
    assert [r["Field"] for r in db(c, "SHOW COLUMNS FROM clients", fetch_all=True)] == real_client_cols      # real tables untouched


# ---------------------------------------------------------------- the full chain


def test_po_cannot_be_booked_before_send_and_review_approval(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"])
    prop = new_proposal(c, people["sales_a"], lead)
    as_(c, people["mgr"])
    r = c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO)                                          # DRAFT
    assert r.status_code == 400 and len(r.json()["detail"]["problems"]) == 2
    assert c.post(f"{R}/proposals/{prop['id']}/review", json={"status": "APPROVED"}).status_code == 400   # can't review a draft
    assert send(c, people["sales_a"], prop["id"]).status_code == 200
    as_(c, people["mgr"])
    r = c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO)                                          # SENT but review PENDING
    assert r.status_code == 400 and r.json()["detail"]["problems"] == ["its review must be APPROVED (it is PENDING)"]
    assert c.post(f"{R}/proposals/{prop['id']}/review", json={"status": "CHANGES_ASKED", "note": ""}).status_code == 400   # needs a note
    assert c.post(f"{R}/proposals/{prop['id']}/review", json={"status": "CHANGES_ASKED", "note": "Add a warranty line"}).status_code == 200
    assert c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO).status_code == 400                    # CHANGES_ASKED
    assert c.post(f"{R}/proposals/{prop['id']}/review", json={"status": "APPROVED"}).status_code == 200
    assert c.post(f"{R}/proposals/{prop['id']}/book-po", json={**PO, "po_reference": " "}).status_code == 400
    assert c.post(f"{R}/proposals/{prop['id']}/book-po", json={**PO, "end_date": "2025-01-01"}).status_code == 400
    assert c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO).status_code == 200
    again = c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO)
    assert again.status_code == 400                                                                      # now ACCEPTED: can't be booked twice
    assert db(c, "SELECT COUNT(*) AS n FROM contracts WHERE proposal_id = %s", (prop["id"],), fetch_one=True)["n"] == 1


def test_editing_a_proposal_after_changes_were_asked_reopens_it(client, people):
    c = client
    lead, prop = qualified_lead(c, people["sales_a"]), None
    prop = new_proposal(c, people["sales_a"], lead)
    send(c, people["sales_a"], prop["id"])
    as_(c, people["sales_a"])
    assert c.put(f"{R}/proposals/{prop['id']}", json={"title": "x"}).status_code == 400                   # sent proposals are frozen…
    approve(c, people["mgr"], prop["id"], "CHANGES_ASKED", "Please add a line")
    old_token = db(c, "SELECT public_token FROM proposals WHERE id = %s", (prop["id"],), fetch_one=True)["public_token"]
    as_(c, people["sales_a"])
    r = c.put(f"{R}/proposals/{prop['id']}", json={"items": [ITEM, {**ITEM, "description": "Warranty", "rate": 500}]})      # …until changes were asked for
    assert r.status_code == 200 and r.json()["status"] == "DRAFT" and r.json()["review_status"] == "PENDING" and r.json()["total_amount"] == 15000.0
    c.cookies.clear()
    assert c.get(f"{PUB}/{old_token}").status_code == 404                                                # the old link stopped working


# ---------------------------------------------------------------- send rules

def test_below_cost_send_needs_a_manager_override_with_a_reason(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"])
    prop = new_proposal(c, people["sales_a"], lead, [ITEM, {"description": "Discounted", "quantity": 1, "unit": "lot", "rate": 700, "cost": 900}])
    assert prop["below_cost_lines"] == [2] and prop["items"][1]["below_cost"] is True and prop["items"][0]["below_cost"] is False
    no = send(c, people["sales_a"], prop["id"])
    assert no.status_code == 400 and no.json()["detail"]["needs_override"] is True and no.json()["detail"]["below_cost_lines"] == [2]
    assert send(c, people["sales_a"], prop["id"], override_reason="Strategic account").status_code == 403         # the Sales role can't approve it
    assert send(c, people["mgr"], prop["id"], override_reason="   ").status_code == 400                           # needs an actual reason
    ok = send(c, people["mgr"], prop["id"], override_reason="Strategic account, volume to follow")
    assert ok.status_code == 200 and ok.json()["override_reason"] == "Strategic account, volume to follow" and ok.json()["status"] == "SENT"
    other = new_proposal(c, people["sales_a"], qualified_lead(c, people["sales_a"]))
    assert send(c, people["sales_a"], other["id"]).status_code == 200                                              # priced above cost: no override needed
    empty = new_proposal(c, people["sales_a"], qualified_lead(c, people["sales_a"]), items=[])
    assert send(c, people["sales_a"], empty["id"]).status_code == 400                                              # no items
    assert send(c, people["sales_a"], other["id"]).status_code == 400                                              # already sent
    as_(c, people["sales_a"])
    assert c.post(f"{R}/proposals/{other['id']}/send", json={"to": "not-an-email"}).status_code == 400


# ---------------------------------------------------------------- invoices

def test_invoice_suggestion_maths(client, people):
    c = client
    _, _, k = active_contract(c, people)                                      # value 365,000 over 2026-01-01 … 2026-12-31 (365 days = 1,000 a day); client TDS 2%, retention 5%
    as_(c, people["acct"])
    jan = c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2026-01").json()
    assert jan["cumulative_billable"] == 31000.0 and jan["already_posted"] == 0 and jan["suggested_gross"] == 31000.0
    assert (jan["tax_pct"], jan["tds_pct"], jan["retention_pct"]) == (18.0, 2.0, 5.0)
    assert (jan["tax_amount"], jan["tds_amount"], jan["retention_amount"], jan["net_amount"]) == (5580.0, 620.0, 1550.0, 34410.0)    # 31,000 + 5,580 − 620 − 1,550
    inv = posted_invoice(c, people, k, "2026-01")
    assert (inv["gross_amount"], inv["net_amount"], inv["status"]) == (31000.0, 34410.0, "POSTED") and inv["invoice_date"]
    as_(c, people["acct"])
    feb = c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2026-02").json()
    assert (feb["cumulative_billable"], feb["already_posted"], feb["suggested_gross"]) == (59000.0, 31000.0, 28000.0)    # cumulative to 28 Feb − already posted
    assert c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2025-06").json()["suggested_gross"] == 0.0          # before the contract started
    assert c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2027-03").json()["cumulative_billable"] == 365000.0  # past the end: the whole value
    assert c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2026-13").status_code == 400
    # a lump-sum contract (no end date) is billable in full from its start
    _, _, lump = active_contract(c, people, end_date=None, contract_value=12345.67)
    as_(c, people["acct"])
    assert c.get(f"{R}/contracts/{lump['id']}/invoice-suggestion?period=2026-01").json()["suggested_gross"] == 12345.67


def test_month_end_job_drafts_one_invoice_per_eligible_contract_without_duplicates(client, people):
    c = client
    _, _, a = active_contract(c, people, start_date="2026-01-01", end_date="2026-12-31", contract_value=365000)        # eligible
    _, _, future = active_contract(c, people, start_date="2026-09-01", end_date="2026-12-31", contract_value=100000)   # starts after March
    _, _, draft = booked_contract(c, people)                                                                           # DRAFT: not active
    _, _, done = active_contract(c, people, start_date="2026-01-01", end_date="2026-12-31", contract_value=50000)
    as_(c, people["mgr"])
    assert c.post(f"{R}/contracts/{done['id']}/status", json={"status": "COMPLETED"}).status_code == 200            # COMPLETED: not drafted
    mine = {a["code"], future["code"], draft["code"], done["code"]}
    as_(c, people["acct"])
    r = c.post(f"{R}/invoices/month-end", json={"month": "2026-03"}).json()
    created = [x for x in r["created"] if x["contract"] in mine]
    assert [x["contract"] for x in created] == [a["code"]] and created[0]["gross_amount"] == 90000.0              # 90 days of 1,000
    reasons = {x["contract"]: x["reason"] for x in r["skipped"] if x["contract"] in mine}
    assert reasons.get(future["code"]) == "not started yet" and draft["code"] not in reasons and done["code"] not in reasons
    inv = db(c, "SELECT * FROM invoices WHERE contract_id = %s", (a["id"],), fetch_all=True)
    assert len(inv) == 1 and inv[0]["status"] == "DRAFT" and inv[0]["generated_by"] == "MONTH_END" and inv[0]["period"] == "2026-03"
    assert float(inv[0]["tds_pct"]) == 2.0 and float(inv[0]["retention_pct"]) == 5.0 and float(inv[0]["tax_pct"]) == 18.0     # defaults from the client
    again = c.post(f"{R}/invoices/month-end", json={"month": "2026-03"}).json()
    assert [x for x in again["created"] if x["contract"] in mine] == []                                           # running twice creates no duplicates
    assert {x["reason"] for x in again["skipped"] if x["contract"] == a["code"]} == {"already has an invoice for this period"}
    assert db(c, "SELECT COUNT(*) AS n FROM invoices WHERE contract_id = %s", (a["id"],), fetch_one=True)["n"] == 1
    # nothing reaches the ledger until it is posted
    assert c.get(f"{R}/clients/{a['client_id']}/ledger").json()["entries"] == []
    assert c.post(f"{R}/invoices/month-end", json={"month": "next spring"}).status_code == 400
    as_(c, people["acct_view"])
    assert c.post(f"{R}/invoices/month-end", json={"month": "2026-03"}).status_code == 403


def test_posting_twice_is_refused_and_posted_invoices_are_final(client, people):
    c = client
    _, _, k = active_contract(c, people)
    as_(c, people["acct"])
    d = c.post(f"{R}/invoices", json={"contract_id": k["id"], "period": "2026-02", "gross_amount": 10000, "notes": "Feb"}).json()
    assert d["status"] == "DRAFT" and c.put(f"{R}/invoices/{d['id']}", json={"gross_amount": 12000, "tds_pct": 10}).json()["net_amount"] == 12000 + 2160 - 1200 - 600
    assert c.post(f"{R}/invoices", json={"contract_id": k["id"], "period": "2026-02"}).status_code == 409           # one live invoice per period
    assert c.post(f"{R}/invoices/{d['id']}/post").status_code == 200
    assert c.post(f"{R}/invoices/{d['id']}/post").status_code == 409                                                 # posting twice
    assert c.put(f"{R}/invoices/{d['id']}", json={"gross_amount": 1}).status_code == 400                             # never edited
    assert c.delete(f"{R}/invoices/{d['id']}").status_code == 400                                                    # never deleted
    assert c.post(f"{R}/invoices/{d['id']}/cancel", json={"reason": " "}).status_code == 400
    # more than has been earned can't be posted
    big = c.post(f"{R}/invoices", json={"contract_id": k["id"], "period": "2026-01", "gross_amount": 99999}).json()
    over = c.post(f"{R}/invoices/{big['id']}/post")
    assert over.status_code == 400 and "can be billed" in over.json()["detail"]
    assert c.delete(f"{R}/invoices/{big['id']}").status_code == 200
    _, _, draft_contract = booked_contract(c, people)
    as_(c, people["acct"])
    assert c.post(f"{R}/invoices", json={"contract_id": draft_contract["id"], "period": "2026-01"}).status_code == 400   # contract not active yet


def test_reversal_restores_balances_and_releases_allocations(client, people):
    c = client
    _, _, k = active_contract(c, people)
    cid = k["client_id"]
    inv1 = posted_invoice(c, people, k, "2026-01")                                         # gross 31,000 → net 34,410
    as_(c, people["acct"])
    ledger = c.get(f"{R}/clients/{cid}/ledger").json()
    assert ledger["balance"] == 34410.0 and ledger["totals"]["invoiced"] == 34410.0
    pay = c.post(f"{R}/payments", json={"client_id": cid, "amount": 10000, "payment_date": "2026-02-10", "reference": "UTR1"}).json()
    c.post(f"{R}/payments/{pay['id']}/post", json={"allocations": [{"invoice_id": inv1["id"], "amount": 10000}]})
    assert c.get(f"{R}/invoices/{inv1['id']}").json()["outstanding"] == 24410.0
    assert c.get(f"{R}/clients/{cid}/ledger").json()["balance"] == 24410.0
    assert c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2026-02").json()["suggested_gross"] == 28000.0

    rev = c.post(f"{R}/invoices/{inv1['id']}/cancel", json={"reason": "Wrong rate"})
    assert rev.status_code == 200 and rev.json()["status"] == "CANCELLED" and rev.json()["cancel_reason"] == "Wrong rate" and rev.json()["outstanding"] == 0.0
    assert c.post(f"{R}/invoices/{inv1['id']}/cancel", json={"reason": "again"}).status_code == 400                # can't reverse twice
    after = c.get(f"{R}/clients/{cid}/ledger").json()
    assert after["balance"] == -10000.0                                                                          # the invoice left the ledger; the payment is now an unallocated credit
    assert after["unallocated_payments"] == 10000.0 and after["outstanding_invoices"] == 0.0
    assert [e["type"] for e in after["entries"]] == ["INVOICE", "PAYMENT", "INVOICE_REVERSAL"] or {e["type"] for e in after["entries"]} == {"INVOICE", "INVOICE_REVERSAL", "PAYMENT"}
    p = c.get(f"{R}/payments/{pay['id']}").json()
    assert p["allocated"] == 0.0 and p["unallocated"] == 10000.0 and p["allocations"][0]["released"] is True
    assert c.get(f"{R}/contracts/{k['id']}/invoice-suggestion?period=2026-02").json()["suggested_gross"] == 59000.0   # billable again: nothing posted any more
    # the period can be invoiced afresh, and the released payment re-allocated
    inv2 = posted_invoice(c, people, k, "2026-01")
    as_(c, people["acct"])
    assert c.post(f"{R}/payments/{pay['id']}/allocate", json={"allocations": [{"invoice_id": inv2["id"], "amount": 10000}]}).json()["unallocated"] == 0.0
    assert c.post(f"{R}/payments/{pay['id']}/allocate", json={"allocations": [{"invoice_id": inv1["id"], "amount": 1}]}).status_code == 400     # not onto a cancelled invoice


# ---------------------------------------------------------------- payments, advances, ledger

def test_payment_allocation_and_ledger_balance(client, people):
    c = client
    _, _, k = active_contract(c, people, contract_value=100000, start_date="2026-01-01", end_date="2026-01-31")          # 100,000 for January alone
    cid = k["client_id"]
    inv = posted_invoice(c, people, k, "2026-01", tax_pct=0, tds_pct=10, retention_pct=0, gross_amount=60000)         # net 54,000
    inv_b = posted_invoice(c, people, k, "2026-02", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=40000)         # net 40,000 (rest of the value)
    other_client = new_client(c, people["sales_a"])
    as_(c, people["acct"])
    pay = c.post(f"{R}/payments", json={"client_id": cid, "amount": 70000, "payment_date": "2026-02-15", "reference": "UTR-77"}).json()
    assert pay["status"] == "DRAFT" and pay["unallocated"] == 0.0 and c.get(f"{R}/clients/{cid}/ledger").json()["balance"] == 94000.0   # a draft isn't in the ledger
    assert c.post(f"{R}/payments/{pay['id']}/allocate", json={"allocations": [{"invoice_id": inv["id"], "amount": 1}]}).status_code == 400       # post it first
    posted = c.post(f"{R}/payments/{pay['id']}/post").json()
    assert posted["status"] == "POSTED" and posted["unallocated"] == 70000.0
    assert c.post(f"{R}/payments/{pay['id']}/post").status_code == 409
    bad = lambda allocs: c.post(f"{R}/payments/{pay['id']}/allocate", json={"allocations": allocs})                    # noqa: E731
    assert bad([{"invoice_id": inv["id"], "amount": 54001}]).status_code == 400                                       # more than the invoice has outstanding
    assert bad([{"invoice_id": inv["id"], "amount": 54000}, {"invoice_id": inv_b["id"], "amount": 16001}]).status_code == 400   # more than the payment
    assert bad([{"invoice_id": inv["id"], "amount": 0}]).status_code == 400
    assert bad([]).status_code == 400
    foreign = db(c, "SELECT id FROM invoices WHERE client_id != %s AND status = 'POSTED' LIMIT 1", (cid,), fetch_one=True)
    if foreign:
        assert bad([{"invoice_id": foreign["id"], "amount": 1}]).status_code == 400                                   # another client's invoice
    ok = bad([{"invoice_id": inv["id"], "amount": 54000}, {"invoice_id": inv_b["id"], "amount": 16000}]).json()
    assert ok["allocated"] == 70000.0 and ok["unallocated"] == 0.0
    assert (c.get(f"{R}/invoices/{inv['id']}").json()["outstanding"], c.get(f"{R}/invoices/{inv_b['id']}").json()["outstanding"]) == (0.0, 24000.0)
    ledger = c.get(f"{R}/clients/{cid}/ledger").json()
    assert ledger["balance"] == 24000.0 and ledger["totals"] == {"invoiced": 94000.0, "payments": 70000.0, "advances": 0.0}
    assert [(e["type"], e["debit"], e["credit"], e["balance"]) for e in ledger["entries"]][-1] == ("PAYMENT", 0.0, 70000.0, 24000.0) or ledger["entries"][-1]["balance"] == 24000.0
    assert [(i["code"], i["outstanding"]) for i in ledger["open_invoices"]] == [(inv_b["code"], 24000.0)]
    assert c.post(f"{R}/payments", json={"client_id": cid, "amount": 0, "payment_date": "2026-02-15"}).status_code == 400
    assert c.post(f"{R}/payments", json={"client_id": cid, "amount": 5, "payment_date": "15/02/2026"}).status_code == 400
    assert c.post(f"{R}/payments", json={"client_id": 99999999, "amount": 5, "payment_date": "2026-02-15"}).status_code == 404
    # cancelling a payment reverses it and releases its allocations
    assert c.post(f"{R}/payments/{pay['id']}/cancel", json={"reason": "Cheque bounced"}).status_code == 200
    back = c.get(f"{R}/clients/{cid}/ledger").json()
    assert back["balance"] == 94000.0 and back["outstanding_invoices"] == 94000.0 and back["totals"]["payments"] == 0.0
    assert c.get(f"{R}/invoices/{inv['id']}").json()["outstanding"] == 54000.0
    # a payment can be posted together with its allocations in one step — and a failure leaves it a draft
    p2 = c.post(f"{R}/payments", json={"client_id": cid, "amount": 1000, "payment_date": "2026-03-01"}).json()
    assert c.post(f"{R}/payments/{p2['id']}/post", json={"allocations": [{"invoice_id": inv["id"], "amount": 2000}]}).status_code == 400
    assert c.get(f"{R}/payments/{p2['id']}").json()["status"] == "DRAFT"
    assert c.post(f"{R}/payments/{p2['id']}/post", json={"allocations": [{"invoice_id": inv["id"], "amount": 1000}]}).json()["allocated"] == 1000.0
    assert other_client["id"] != cid


def test_advances_adjust_against_invoices_correctly(client, people):
    c = client
    _, _, k = active_contract(c, people, contract_value=100000, start_date="2026-01-01", end_date="2026-01-31")
    cid = k["client_id"]
    inv = posted_invoice(c, people, k, "2026-01", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=100000)
    as_(c, people["acct"])
    adv = c.post(f"{R}/advances", json={"client_id": cid, "amount": 30000, "advance_date": "2026-01-05", "reference": "ADV-1"}).json()
    assert adv["status"] == "OPEN" and adv["remaining"] == 30000.0 and adv["code"].startswith("ADV-")
    led = c.get(f"{R}/clients/{cid}/ledger").json()
    assert led["balance"] == 70000.0 and led["advances_remaining"] == 30000.0 and led["totals"]["advances"] == 30000.0     # the advance is a credit from the day it was received
    a1 = c.post(f"{R}/advances/{adv['id']}/adjust", json={"invoice_id": inv["id"], "amount": 20000}).json()
    assert a1["status"] == "PARTLY_ADJUSTED" and a1["adjusted"] == 20000.0 and a1["remaining"] == 10000.0
    assert c.get(f"{R}/invoices/{inv['id']}").json()["outstanding"] == 80000.0
    led = c.get(f"{R}/clients/{cid}/ledger").json()
    assert led["balance"] == 70000.0 and led["advances_remaining"] == 10000.0 and led["outstanding_invoices"] == 80000.0   # adjusting moves money between documents, the balance doesn't change
    assert c.post(f"{R}/advances/{adv['id']}/adjust", json={"invoice_id": inv["id"], "amount": 10001}).status_code == 400   # more than is left
    assert c.post(f"{R}/advances/{adv['id']}/adjust", json={"invoice_id": inv["id"], "amount": 0}).status_code == 400
    assert c.post(f"{R}/advances/{adv['id']}/cancel", json={"reason": "mistake"}).status_code == 400                       # already used
    assert c.post(f"{R}/advances/{adv['id']}/adjust", json={"invoice_id": inv["id"], "amount": 10000}).json()["status"] == "ADJUSTED"
    assert c.post(f"{R}/advances/{adv['id']}/adjust", json={"invoice_id": inv["id"], "amount": 1}).status_code == 400
    assert c.get(f"{R}/invoices/{inv['id']}").json()["outstanding"] == 70000.0
    # reversing the invoice frees the advance again
    assert c.post(f"{R}/invoices/{inv['id']}/cancel", json={"reason": "Raised in error"}).status_code == 200
    freed = c.get(f"{R}/advances/{adv['id']}").json()
    assert freed["status"] == "OPEN" and freed["remaining"] == 30000.0
    assert c.get(f"{R}/clients/{cid}/ledger").json()["balance"] == -30000.0                                                # we hold 30,000 of the client's money
    other = c.post(f"{R}/advances", json={"client_id": cid, "amount": 500, "advance_date": "2026-02-01"}).json()
    assert c.post(f"{R}/advances/{other['id']}/cancel", json={"reason": "Entered twice"}).json()["status"] == "CANCELLED"
    assert c.get(f"{R}/clients/{cid}/ledger").json()["balance"] == -30000.0                                                # a cancelled advance nets to nothing
    assert c.post(f"{R}/advances", json={"client_id": cid, "amount": -1, "advance_date": "2026-02-01"}).status_code == 400
    assert any(r["client_id"] == cid and r["balance"] == -30000.0 for r in c.get(f"{R}/ledger").json())


# ---------------------------------------------------------------- the public reply link

def test_public_proposal_reply_link_needs_no_login_and_exposes_only_that_proposal(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"])
    p1 = new_proposal(c, people["sales_a"], lead, [{"description": "Special work", "quantity": 2, "unit": "days", "rate": 1500, "cost": 900}], title="ZZCM <script>alert(1)</script> Offer")
    p2 = new_proposal(c, people["sales_a"], qualified_lead(c, people["sales_a"]))
    for p in (p1, p2):
        assert send(c, people["sales_a"], p["id"]).status_code == 200
    tok1 = db(c, "SELECT public_token FROM proposals WHERE id = %s", (p1["id"],), fetch_one=True)["public_token"]
    tok2 = db(c, "SELECT public_token FROM proposals WHERE id = %s", (p2["id"],), fetch_one=True)["public_token"]
    assert len(tok1) >= 40 and tok1 != tok2
    c.cookies.clear()                                                                                        # no login at all
    v = c.get(f"{PUB}/{tok1}")
    assert v.status_code == 200
    body = v.json()
    assert body["code"] == p1["code"] and body["total_amount"] == 3000.0 and body["can_reply"] is True and body["items"][0]["description"] == "Special work"
    text = v.text
    assert "cost" not in text and "margin" not in text and "owner" not in text and "900" not in text and "total_cost" not in text      # nothing internal
    assert p2["code"] not in text                                                                            # only that proposal
    assert c.get(f"{PUB}/{tok2}").json()["code"] == p2["code"]
    for bad in ("not-a-token", "x" * 43, tok1[:-1] + ("A" if tok1[-1] != "A" else "B"), "../../etc/passwd"):
        assert c.get(f"{PUB}/{bad}").status_code == 404, bad                                                 # invalid token → 404
        assert c.post(f"{PUB}/{bad}/reply", json={"action": "accept"}).status_code == 404
    page = c.get(f"{PUB}/{tok1}/page")
    assert page.status_code == 200 and "<script>alert(1)</script>" not in page.text and "&lt;script&gt;" in page.text and "Accept proposal" in page.text    # no markup injection
    assert c.get(f"{PUB}/bad-token/page").status_code == 404

    PLAIN_EMAILS.clear()
    assert c.post(f"{PUB}/{tok1}/reply", json={"action": "maybe"}).status_code == 400
    assert c.post(f"{PUB}/{tok1}/reply", json={"action": "changes", "message": "  "}).status_code == 400          # changes need a message
    ch = c.post(f"{PUB}/{tok1}/reply", json={"action": "changes", "message": "Please cut the price", "name": "Asha"})
    assert ch.status_code == 200 and ch.json()["reply"] == "CHANGES_ASKED"
    assert wait_for(lambda: bool(PLAIN_EMAILS))
    assert PLAIN_EMAILS and PLAIN_EMAILS[-1][0] == [people["sales_a"]["email"]] and "asked for changes" in PLAIN_EMAILS[-1][1] and PLAIN_EMAILS[-1][3] == "sales"   # the owner is told
    row = db(c, "SELECT review_status, client_response, client_message, status FROM proposals WHERE id = %s", (p1["id"],), fetch_one=True)
    assert row == {"review_status": "CHANGES_ASKED", "client_response": "CHANGES_ASKED", "client_message": "Please cut the price", "status": "SENT"}
    acc = c.post(f"{PUB}/{tok2}/reply", json={"action": "accept", "name": "Bob"})
    assert acc.status_code == 200 and acc.json()["reply"] == "ACCEPTED"
    row2 = db(c, "SELECT status, review_status, client_response FROM proposals WHERE id = %s", (p2["id"],), fetch_one=True)
    assert row2 == {"status": "SENT", "review_status": "PENDING", "client_response": "ACCEPTED"}                    # an accept alone does not approve the review or book a PO
    as_(c, people["sales_a"])
    log = c.get(f"{R}/activity", params={"opportunity_id": p1["opportunity_id"]}).json()
    assert any("Client reply" in a["notes"] and "asked for changes" in a["notes"] and a["bdr"] == "Asha (client)" for a in log)
    # once the PO is booked the link is read-only
    approve(c, people["mgr"], p2["id"])
    as_(c, people["mgr"])
    assert c.post(f"{R}/proposals/{p2['id']}/book-po", json=PO).status_code == 200
    c.cookies.clear()
    assert c.get(f"{PUB}/{tok2}").json()["can_reply"] is False
    assert c.post(f"{PUB}/{tok2}/reply", json={"action": "accept"}).status_code == 409
    as_(c, people["sales_a"])
    assert c.post(f"{R}/proposals/{p1['id']}/reject", json={"reason": "Lost to a competitor"}).status_code == 200
    c.cookies.clear()
    assert c.get(f"{PUB}/{tok1}").status_code == 404                                                         # a rejected proposal's link is dead


# ---------------------------------------------------------------- duplicates, import, leads




def test_contract_engagement_link_edit_and_status(client, people):
    c = client
    _, _, k = booked_contract(c, people)
    as_(c, people["mgr"])
    assert c.put(f"{R}/contracts/{k['id']}", json={"contract_value": 200000, "estimated_cost": 150000, "end_date": "2027-03-31"}).json()["margin_pct"] == 25.0
    assert c.put(f"{R}/contracts/{k['id']}", json={"end_date": "2025-01-01"}).status_code == 400
    mine = db(c, "INSERT INTO projects (name, project_key, description, status, owner_id, created_at, updated_at) VALUES (%s, %s, '', 'active', %s, 'now', 'now')",
              (f"ZZCM Existing Project {uniq()}", f"ZC{uniq()}"[:10], people["mgr"]["id"]), last_id=True)
    linked = c.post(f"{R}/contracts/{k['id']}/engagement", json={"project_id": mine}).json()
    assert linked["status"] == "ACTIVE" and linked["engagement_project_id"] == mine
    assert db(c, "SELECT client_id, contract_id FROM projects WHERE id = %s", (mine,), fetch_one=True) == {"client_id": k["client_id"], "contract_id": k["id"]}
    assert c.put(f"{R}/contracts/{k['id']}", json={"contract_value": 1}).status_code == 400               # only a draft is editable
    _, _, k2 = booked_contract(c, people)
    as_(c, people["mgr"])
    assert c.post(f"{R}/contracts/{k2['id']}/engagement", json={"project_id": mine}).status_code == 409       # already another contract's engagement
    assert c.post(f"{R}/contracts/{k2['id']}/engagement", json={"project_id": 99999999}).status_code == 404
    assert c.post(f"{R}/contracts/{k['id']}/status", json={"status": "TERMINATED"}).status_code == 400     # needs a reason
    assert c.post(f"{R}/contracts/{k['id']}/status", json={"status": "TERMINATED", "note": "Client insolvency"}).json()["status"] == "TERMINATED"
    assert c.post(f"{R}/contracts/{k2['id']}/status", json={"status": "COMPLETED"}).status_code == 400    # still a draft


def test_proposal_files_are_validated_and_owner_only(client, people):
    c = client
    prop = new_proposal(c, people["sales_a"], qualified_lead(c, people["sales_a"]))
    as_(c, people["sales_a"])
    assert c.post(f"{R}/proposals/{prop['id']}/files", files={"file": ("evil.exe", b"MZ", "application/octet-stream")}).status_code == 400
    assert c.post(f"{R}/proposals/{prop['id']}/files", files={"file": ("empty.pdf", b"", "application/pdf")}).status_code == 400
    up = c.post(f"{R}/proposals/{prop['id']}/files", files={"file": ("scope.pdf", b"%PDF-1.4 scope", "application/pdf")})
    assert up.status_code == 200
    got = c.get(f"{R}/proposals/{prop['id']}/files/{up.json()['id']}")
    assert got.status_code == 200 and got.content == b"%PDF-1.4 scope" and got.headers["cache-control"] == "private, no-store"
    assert c.get(f"{R}/proposals/{prop['id']}").json()["files"][0]["filename"] == "scope.pdf"
    assert as_(c, people["sales_b"]).get(f"{R}/proposals/{prop['id']}/files/{up.json()['id']}").status_code == 404
    assert c.post(f"{R}/proposals/{prop['id']}/files", files={"file": ("x.pdf", b"%PDF", "application/pdf")}).status_code == 404
    assert as_(c, people["sales_a"]).delete(f"{R}/proposals/{prop['id']}/files/{up.json()['id']}").status_code == 200


# ---------------------------------------------------------------- permissions

def test_permissions_per_role(client, people):
    c = client
    opp_a = qualified_lead(c, people["sales_a"])
    prop_a = new_proposal(c, people["sales_a"], opp_a)
    lead_a = new_lead(c, people["sales_a"])
    lead_b = new_lead(c, people["sales_b"])
    _, _, k = active_contract(c, people)
    inv = posted_invoice(c, people, k, "2026-01")

    # --- Sales (edit): works only their own leads and proposals; no review, PO, engagement or accounting
    as_(c, people["sales_a"])
    mine = {x["id"] for x in c.get(f"{R}/leads").json()}
    assert lead_a["id"] in mine and lead_b["id"] not in mine
    assert c.get(f"{R}/leads/{lead_b['id']}").status_code == 404 and c.put(f"{R}/leads/{lead_b['id']}", json={"contact_person": "x"}).status_code == 404
    assert c.get(f"{R}/proposals/{prop_a['id']}").status_code == 200
    assert {p["id"] for p in c.get(f"{R}/proposals").json()} >= {prop_a["id"]}
    assert c.post(f"{R}/proposals/{prop_a['id']}/review", json={"status": "APPROVED"}).status_code == 403
    assert c.post(f"{R}/proposals/{prop_a['id']}/book-po", json=PO).status_code == 403
    assert c.post(f"{R}/contracts/{k['id']}/engagement", json={}).status_code == 403
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x", "owner_id": people["sales_b"]["id"]}).status_code == 403      # can't assign to someone else
    assert c.get(f"{R}/invoices").status_code == 403 and c.post(f"{R}/invoices", json={"contract_id": k["id"], "period": "2026-02"}).status_code == 403
    assert c.get(f"{R}/payments").status_code == 403 and c.get(f"{R}/clients/{k['client_id']}/ledger").status_code == 403
    assert c.delete(f"{R}/clients/{k['client_id']}").status_code == 403
    assert c.get(f"{R}/contracts/{k['id']}").status_code == 200                                                      # the contract came from their own proposal
    # --- another salesperson sees theirs, not a_'s
    as_(c, people["sales_b"])
    assert c.get(f"{R}/proposals/{prop_a['id']}").status_code == 404 and send(c, people["sales_b"], prop_a["id"]).status_code == 404
    as_(c, people["sales_b"])
    assert c.get(f"{R}/contracts/{k['id']}").status_code == 404 and k["id"] not in {x["id"] for x in c.get(f"{R}/contracts").json()}        # contracts follow their proposal's owner
    # --- Sales (view only): reads everything, writes nothing
    as_(c, people["sales_view"])
    assert {lead_a["id"], lead_b["id"]} <= {x["id"] for x in c.get(f"{R}/leads").json()} and c.get(f"{R}/proposals/{prop_a['id']}").status_code == 200
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x"}).status_code == 403 and c.put(f"{R}/leads/{lead_a['id']}", json={"contact_person": "x"}).status_code == 403
    assert c.post(f"{R}/clients", json={"name": "ZZCM viewer client"}).status_code == 403 and c.post(f"{R}/leads/{lead_a['id']}/convert", json={}).status_code == 403
    assert c.get(f"{R}/dashboard").status_code == 200 and c.get(f"{R}/opportunities").status_code == 200
    # --- Manager (delete): everything on the sales side, anyone's work
    as_(c, people["mgr"])
    assert c.get(f"{R}/leads/{lead_b['id']}").status_code == 200 and c.put(f"{R}/leads/{lead_b['id']}", json={"contact_person": "Reassigned"}).status_code == 200
    assert c.put(f"{R}/leads/{lead_b['id']}", json={"owner_id": people["sales_a"]["id"]}).json()["owner_id"] == people["sales_a"]["id"]
    assert c.get(f"{R}/invoices").status_code == 403                                                                     # but not accounting
    # --- Accounts (edit): invoices, payments, advances, ledger; read-only on clients and contracts; no sales actions
    as_(c, people["acct"])
    assert c.get(f"{R}/clients").status_code == 200 and c.get(f"{R}/contracts/{k['id']}").status_code == 200
    assert c.get(f"{R}/invoices/{inv['id']}").status_code == 200 and c.get(f"{R}/clients/{k['client_id']}/ledger").status_code == 200
    assert c.get(f"{R}/leads").status_code == 403 and c.post(f"{R}/leads", json={"company_name": "ZZCM x"}).status_code == 403
    assert c.post(f"{R}/clients", json={"name": "ZZCM acct client"}).status_code == 403
    assert c.post(f"{R}/proposals/{prop_a['id']}/book-po", json=PO).status_code == 403
    # --- Accounts (view only): reads, can't post / pay / reverse
    as_(c, people["acct_view"])
    assert c.get(f"{R}/invoices").status_code == 200 and c.get(f"{R}/dashboard").status_code == 200
    assert c.post(f"{R}/invoices/{inv['id']}/cancel", json={"reason": "x"}).status_code == 403
    assert c.post(f"{R}/payments", json={"client_id": k["client_id"], "amount": 1, "payment_date": "2026-01-01"}).status_code == 403
    assert c.post(f"{R}/advances", json={"client_id": k["client_id"], "amount": 1, "advance_date": "2026-01-01"}).status_code == 403
    assert c.post(f"{R}/invoices/month-end", json={}).status_code == 403
    # --- nobody else
    for who in ("plain", "plain_mgr"):
        as_(c, people[who])
        for url in ("clients", "leads", "proposals", "contracts", "invoices", "payments", "advances", "ledger", "opportunities", "followups", "activity", "dashboard"):
            assert c.get(f"{R}/{url}").status_code == 403, (who, url)
        assert c.post(f"{R}/leads", json={"company_name": "ZZCM x"}).status_code == 403
    c.cookies.clear()
    assert c.get(f"{R}/leads").status_code == 401 and c.get(f"{R}/dashboard").status_code == 401
    # an admin can do all of it
    as_(c, people["admin"])
    assert c.get(f"{R}/invoices").status_code == 200 and c.get(f"{R}/leads").status_code == 200 and c.get(f"{R}/opportunities").status_code == 200


# ---------------------------------------------------------------- KPIs and the pipeline summary



def test_receivables_overdue_over_60_days(client, people):
    c = client
    _, _, k = active_contract(c, people, contract_value=100000, start_date="2026-01-01", end_date="2026-01-31")
    as_(c, people["acct"])
    before = c.get(f"{R}/dashboard").json()["kpis"]["receivables_overdue_60"]
    old = posted_invoice(c, people, k, "2026-01", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=60000)
    recent = posted_invoice(c, people, k, "2026-02", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=40000)
    db(c, "UPDATE invoices SET invoice_date = %s WHERE id = %s", ((datetime.now(timezone.utc) - timedelta(days=75)).strftime("%Y-%m-%d"), old["id"]))
    db(c, "UPDATE invoices SET invoice_date = %s WHERE id = %s", ((datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d"), recent["id"]))
    as_(c, people["acct"])
    after = c.get(f"{R}/dashboard").json()["kpis"]["receivables_overdue_60"]
    base_amount, base_n = (before["amount"], before["invoices"]) if before else (0.0, 0)
    assert after["amount"] - base_amount == 60000.0 and after["invoices"] - base_n == 1                    # only the 75-day-old invoice counts
    pay = c.post(f"{R}/payments", json={"client_id": k["client_id"], "amount": 25000, "payment_date": "2026-03-01"}).json()
    c.post(f"{R}/payments/{pay['id']}/post", json={"allocations": [{"invoice_id": old["id"], "amount": 25000}]})
    assert c.get(f"{R}/dashboard").json()["kpis"]["receivables_overdue_60"]["amount"] - base_amount == 35000.0           # part-paid: only what is still outstanding
    ledger = c.get(f"{R}/clients/{k['client_id']}/ledger").json()
    assert {i["code"]: i["overdue_60"] for i in ledger["open_invoices"]} == {old["code"]: True, recent["code"]: False}


# ---------------------------------------------------------------- additions for the screens

def test_access_flags_for_the_front_end_and_owner_picker(client, people):
    c = client
    expect = {"sales_a": ("sales", None), "mgr": ("mgr", None), "sales_view": ("viewer", None), "acct": (None, "acct"), "acct_view": (None, "viewer"), "plain": (None, None), "admin": ("mgr", "acct")}
    for who, (sales, accounts) in expect.items():
        me = as_(c, people[who]).get("/api/auth/me").json()["client_mgmt"]
        assert me == {"access": bool(sales or accounts), "sales": sales, "accounts": accounts}, who
    as_(c, people["sales_a"])
    assert {"id", "name"} <= set(c.get(f"{R}/people").json()[0])
    assert as_(c, people["plain"]).get(f"{R}/people").status_code == 403


# ---------------------------------------------------------------- Phase 3: scope / PO / agreement, alerts, exports, reminders

def test_scope_flows_from_proposal_to_contract_and_stays_off_internal_views(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"])
    scope = "Design, build and hand over the HR portal.\nTwo rounds of revisions."
    prop = new_proposal(c, people["sales_a"], lead, scope_of_work=scope)
    assert prop["scope_of_work"] == scope
    as_(c, people["sales_a"])
    assert c.put(f"{R}/proposals/{prop['id']}", json={"scope_of_work": scope + "\nTraining."}).json()["scope_of_work"].endswith("Training.")
    assert c.get(f"{R}/proposals/{prop['id']}/pdf").content[:4] == b"%PDF"
    send(c, people["sales_a"], prop["id"])
    token = db(c, "SELECT public_token FROM proposals WHERE id = %s", (prop["id"],), fetch_one=True)["public_token"]
    assert c.get(f"{PUB}/{token}").json()["scope_of_work"].endswith("Training.")
    approve(c, people["mgr"], prop["id"])
    as_(c, people["mgr"])
    k = c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO).json()
    assert k["scope_of_work"].endswith("Training.") and k["agreement_status"] == "NONE"
    assert k["readiness"] == {"po_document": False, "agreement_signed": False, "scope_defined": True}


def test_po_document_and_agreement_flow(client, people):
    c = client
    _, _, k = booked_contract(c, people)
    pdf = ("po.pdf", b"%PDF-1.4 po", "application/pdf")
    as_(c, people["mgr"])
    assert c.post(f"{R}/contracts/{k['id']}/files?kind=PO", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
    assert c.post(f"{R}/contracts/{k['id']}/files?kind=BOGUS", files={"file": pdf}).status_code == 400
    assert c.post(f"{R}/contracts/{k['id']}/files?kind=PO", files={"file": ("empty.pdf", b"", "application/pdf")}).status_code == 400
    po = c.post(f"{R}/contracts/{k['id']}/files?kind=PO", files={"file": pdf}).json()
    assert c.get(f"{R}/contracts/{k['id']}/files/{po['id']}").content == b"%PDF-1.4 po"
    assert [f["kind"] for f in c.get(f"{R}/contracts/{k['id']}/files").json()] == ["PO"]
    assert c.get(f"{R}/contracts/{k['id']}").json()["readiness"]["po_document"] is True
    # the agreement: generated from the contract, wording editable until signed
    r = c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_terms": "Payment within 30 days.", "agreement_status": "DRAFT"})
    assert r.status_code == 200 and r.json()["agreement_status"] == "DRAFT"
    agr = c.get(f"{R}/contracts/{k['id']}/agreement-pdf")
    assert agr.status_code == 200 and agr.content[:4] == b"%PDF"
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_status": "SENT"}).json()["agreement_status"] == "SENT"
    # signing needs the date and the signed copy
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_status": "SIGNED"}).status_code == 400
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_status": "SIGNED", "agreement_signed_on": "2026-01-05"}).status_code == 400       # no signed copy yet
    signed = c.post(f"{R}/contracts/{k['id']}/files?kind=SIGNED_AGREEMENT", files={"file": ("signed.pdf", b"%PDF signed", "application/pdf")}).json()
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_status": "SIGNED"}).status_code == 400                                              # still no date
    done = c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_status": "SIGNED", "agreement_signed_on": "2026-01-05"}).json()
    assert done["agreement_status"] == "SIGNED" and done["agreement_signed_on"] == "2026-01-05" and done["readiness"]["agreement_signed"] is True
    # signed = final
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_terms": "changed"}).status_code == 400
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_status": "DRAFT"}).status_code == 400
    assert c.delete(f"{R}/contracts/{k['id']}/files/{signed['id']}").status_code == 400
    assert c.delete(f"{R}/contracts/{k['id']}/files/{po['id']}").status_code == 200
    # only a manager writes; sales can read their own contract's paperwork; others can't see another owner's
    as_(c, people["sales_a"])
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"agreement_terms": "x"}).status_code == 403
    assert c.post(f"{R}/contracts/{k['id']}/files?kind=PO", files={"file": pdf}).status_code == 403
    assert c.get(f"{R}/contracts/{k['id']}/files").status_code == 200
    as_(c, people["sales_b"])
    assert c.get(f"{R}/contracts/{k['id']}/files").status_code == 404 and c.get(f"{R}/contracts/{k['id']}/agreement-pdf").status_code == 404


def test_alerts_aging_and_dashboard_follow_access(client, people):
    c = client
    _, _, k = active_contract(c, people, contract_value=100000, start_date="2026-01-01", end_date="2026-01-31")
    inv = posted_invoice(c, people, k, "2026-01", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=50000)
    db(c, "UPDATE invoices SET invoice_date = %s WHERE id = %s", ((datetime.now(timezone.utc) - timedelta(days=75)).strftime("%Y-%m-%d"), inv["id"]))
    as_(c, people["acct"])
    aging = c.get(f"{R}/receivables").json()
    row = next(i for i in aging["invoices"] if i["invoice_id"] == inv["id"])
    assert row["bucket"] == "61-90" and row["outstanding"] == 50000.0
    assert sum(b["amount"] for b in aging["buckets"]) == aging["total"]
    alerts = c.get(f"{R}/alerts").json()
    assert any(a["kind"] == "RECEIVABLE_OVERDUE" and a.get("invoice_id") == inv["id"] and a["severity"] == "high" for a in alerts)
    assert any(a["kind"] == "AGREEMENT_UNSIGNED" and a.get("contract_id") == k["id"] for a in alerts)           # Accounts see contract paperwork gaps too
    dash = c.get(f"{R}/dashboard").json()
    assert dash["aging"]["total"] == aging["total"] and len(dash["trend"]) == 6 and set(dash["trend"][0]) == {"month", "invoiced", "collected"}
    # Sales: their own sales alerts, no money
    as_(c, people["mgr"])
    mgr_alerts = c.get(f"{R}/alerts").json()
    assert not any(a["kind"] in ("RECEIVABLE_OVERDUE", "DRAFT_INVOICES") for a in mgr_alerts)
    d = c.get(f"{R}/dashboard").json()
    assert d["aging"] is None and d["trend"] is None
    assert c.get(f"{R}/receivables").status_code == 403
    as_(c, people["plain"])
    assert c.get(f"{R}/alerts").status_code == 403 and c.get(f"{R}/dashboard").status_code == 403





def test_only_superadmin_grants_give_management_access(client, people):
    c = client
    # a manager (team lead) with a grant from a non-superadmin admin gets nothing; the same grant from the superadmin counts
    from app.core.config import SUPERADMIN_EMAILS
    other_admin = db(c, "SELECT id, email FROM users WHERE role = 'admin' ORDER BY id", fetch_all=True)
    other = next((a for a in other_admin if a["email"].lower() not in SUPERADMIN_EMAILS), None)
    lead = _mk_user(c, "teamlead", "manager")
    if other:
        db(c, "INSERT INTO user_permissions (user_id, module, can_view, can_edit, can_delete, granted_by) VALUES (%s, 'employees', 1, 0, 0, %s)", (lead["id"], other["id"]))
        as_(c, lead)
        me = c.get("/api/auth/me").json()
        assert me["module_permissions"] == {}                                  # not shown the Management Panel, no module access
        db(c, "DELETE FROM user_permissions WHERE user_id = %s", (lead["id"],))
    db(c, "INSERT INTO user_permissions (user_id, module, can_view, can_edit, can_delete, granted_by) VALUES (%s, 'employees', 1, 0, 0, %s)", (lead["id"], _superadmin_id(c)))
    as_(c, lead)
    assert c.get("/api/auth/me").json()["module_permissions"]["employees"]["view"] is True
    # only a superadmin may hand out access
    from app.core.permissions import can_grant
    assert can_grant({"role": "admin", "email": sorted(SUPERADMIN_EMAILS)[0]}, "manager") and can_grant({"role": "admin", "email": sorted(SUPERADMIN_EMAILS)[0]}, "employee")
    assert not can_grant({"role": "admin", "email": "someone-else@example.com"}, "manager") and not can_grant({"role": "admin", "email": "someone-else@example.com"}, "employee")



def test_web_form_link_for_sales_users_only(client, people):
    c = client
    as_(c, people["sales_a"])
    r = c.get(f"{R}/web-form")
    assert r.status_code == 200 and r.json()["url"].endswith("/api/public/lead-form") and "<iframe" in r.json()["embed"]
    as_(c, people["acct"])
    assert c.get(f"{R}/web-form").status_code == 403           # accounts-only people don't manage lead capture
    as_(c, people["plain"])
    assert c.get(f"{R}/web-form").status_code == 403


def test_amounts_in_words_use_indian_numbering():
    from app.services.proposal_pdf import rupees_in_words
    assert rupees_in_words(70800) == "Rupees Seventy Thousand Eight Hundred Only"
    assert rupees_in_words(1234567.5) == "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise Only"
    assert rupees_in_words(0) == "Rupees Zero Only" and rupees_in_words(10000000) == "Rupees One Crore Only"


def test_gst_on_proposal_and_commercial_pdf(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"])
    prop = new_proposal(c, people["sales_a"], lead, tax_pct=12, scope_of_work="## Platform\n- Hosting\n- Support", terms="## Payment Terms\nUpfront.")
    assert prop["tax_pct"] == 12.0
    as_(c, people["sales_a"])
    assert c.put(f"{R}/proposals/{prop['id']}", json={"tax_pct": 5}).json()["tax_pct"] == 5.0
    assert c.put(f"{R}/proposals/{prop['id']}", json={"tax_pct": 150}).status_code == 400
    pdf = c.get(f"{R}/proposals/{prop['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    from app.services.proposal_pdf import parse_sections
    assert parse_sections("intro\n\n## A\nx\n\n## B\ny") == [(None, "intro"), ("A", "x"), ("B", "y")]


def test_invoice_pdf_and_explicit_email(client, people):
    from app.services import cm_documents
    c = client
    sent = []
    cm_documents._send_with_attachments = lambda to, subject, html, attachments, category="sales": sent.append((to, subject, [a[0] for a in attachments], [a[1][:4] for a in attachments]))
    _, _, k = active_contract(c, people, contract_value=100000, start_date="2026-01-01", end_date="2026-12-31")
    as_(c, people["acct"])
    draft = c.post(f"{R}/invoices", json={"contract_id": k["id"], "period": "2026-01", "gross_amount": 8000}).json()
    assert c.get(f"{R}/invoices/{draft['id']}/pdf").content[:4] == b"%PDF"                                   # a draft can be previewed
    assert c.post(f"{R}/invoices/{draft['id']}/email", json={"to": "x@example.com"}).status_code == 400    # but not emailed before posting
    posted = c.post(f"{R}/invoices/{draft['id']}/post")
    assert posted.status_code == 200, posted.text
    inv = posted.json()
    assert sent == []                                                                                        # posting never emails by itself
    assert c.post(f"{R}/invoices/{inv['id']}/email", json={"to": "nonsense"}).status_code == 400
    assert c.post(f"{R}/invoices/{inv['id']}/email", json={"to": f"{TAG}-client@example.com", "include_scope": False}).status_code == 200
    assert wait_for(lambda: len(sent) == 1) and sent[0][0] == f"{TAG}-client@example.com" and sent[0][2] == [f"{inv['code']}.pdf"] and sent[0][3] == [b"%PDF"]
    assert c.get(f"{R}/invoices/{inv['id']}").json()["emailed_to"] == f"{TAG}-client@example.com"
    # only Accounts (edit) may email; viewers and sales can't even fetch the PDF
    as_(c, people["acct_view"])
    assert c.get(f"{R}/invoices/{inv['id']}/pdf").status_code == 200 and c.post(f"{R}/invoices/{inv['id']}/email", json={"to": "a@example.com"}).status_code == 403
    as_(c, people["sales_a"])
    assert c.get(f"{R}/invoices/{inv['id']}/pdf").status_code == 403


def test_contract_documents_scope_pdf_and_explicit_send(client, people):
    from app.services import cm_documents
    c = client
    sent = []
    cm_documents._send_with_attachments = lambda to, subject, html, attachments, category="sales": sent.append((to, subject, [a[0] for a in attachments]))
    lead, prop, k = booked_contract(c, people)
    as_(c, people["mgr"])
    assert c.post(f"{R}/contracts/{k['id']}/send-documents", json={"to": "c@example.com", "documents": ["scope"]}).status_code == 400          # no scope written yet
    assert c.put(f"{R}/contracts/{k['id']}/agreement", json={"scope_of_work": "## Platform\n- Hosting"}).status_code == 200
    assert c.get(f"{R}/contracts/{k['id']}/scope-pdf").content[:4] == b"%PDF"
    assert c.post(f"{R}/contracts/{k['id']}/send-documents", json={"to": "c@example.com", "documents": []}).status_code == 400
    assert c.post(f"{R}/contracts/{k['id']}/send-documents", json={"to": "c@example.com", "documents": ["bogus"]}).status_code == 400
    assert sent == []
    r = c.post(f"{R}/contracts/{k['id']}/send-documents", json={"to": "c@example.com", "message": "As discussed", "documents": ["commercial", "scope", "agreement"]})
    assert r.status_code == 200 and wait_for(lambda: len(sent) == 1)
    assert sent[0][0] == "c@example.com" and len(sent[0][2]) == 3 and any("commercial-proposal" in n for n in sent[0][2])
    assert any("Emailed to c@example.com" in a["notes"] for a in c.get(f"{R}/activity", params={"client_id": k["client_id"]}).json())
    as_(c, people["sales_a"])
    assert c.post(f"{R}/contracts/{k['id']}/send-documents", json={"to": "c@example.com", "documents": ["scope"]}).status_code == 403


# ---------------------------------------------------------------- the Sales CRM design (leads / accounts / opportunities / follow-ups / activity log / overview / import)

def new_opp(c, who, **extra):
    as_(c, who)
    body = {"company_name": f"ZZCM Opp Co {uniq()}", "opp_name": None, "contact_person": "Mala", "deal_value": 100000, **extra}
    r = c.post(f"{R}/opportunities", json=body)
    assert r.status_code == 200, r.text
    return r.json()

def test_leads_follow_the_sheet_columns_scope_and_duplicate_rules(client, people):
    c = client
    lead = new_lead(c, people["sales_a"], interested_in="Construction ERP", next_action="Call Monday", status="Contacted")
    assert lead["code"].startswith("L-") and lead["status"] == "Contacted" and lead["source"] == "Referral" and lead["date_added"] == datetime.now().strftime("%Y-%m-%d") or lead["date_added"]
    assert lead["bdr"] == "ZZCM sales-a" and lead["converted"] is False and lead["interested_in"] == "Construction ERP" and lead["location"] == "Chennai"
    # dropdown values are enforced; Converted only comes from converting
    as_(c, people["sales_a"])
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x", "source": "Carrier pigeon"}).status_code == 400
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x", "status": "Converted"}).status_code == 400
    assert c.post(f"{R}/leads", json={"contact_person": "nobody"}).status_code == 200                       # a contact alone is enough
    assert c.post(f"{R}/leads", json={}).status_code == 400
    # same email or phone: warned, can be confirmed
    dup = c.post(f"{R}/leads", json={"company_name": "ZZCM again", "email": lead["email"]})
    assert dup.status_code == 409 and dup.json()["detail"]["duplicates"][0]["id"] == lead["id"] and dup.json()["detail"]["can_confirm"]
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM again", "email": lead["email"], "confirm_duplicate": True}).status_code == 200
    # filters
    assert any(l["id"] == lead["id"] for l in c.get(f"{R}/leads", params={"status": "Contacted"}).json())
    assert not any(l["id"] == lead["id"] for l in c.get(f"{R}/leads", params={"status": "New"}).json())
    assert any(l["id"] == lead["id"] for l in c.get(f"{R}/leads", params={"q": lead["company_name"][:15]}).json())
    assert c.get(f"{R}/leads", params={"status": "bogus"}).status_code == 400
    # edit own; another BDR can't see or change it; a manager can reassign
    assert c.put(f"{R}/leads/{lead['id']}", json={"status": "Working", "next_action": "Send demo link"}).json()["status"] == "Working"
    as_(c, people["sales_b"])
    assert c.get(f"{R}/leads/{lead['id']}").status_code == 404 and not any(l["id"] == lead["id"] for l in c.get(f"{R}/leads").json())
    as_(c, people["mgr"])
    assert c.put(f"{R}/leads/{lead['id']}", json={"owner_id": people["sales_b"]["id"]}).json()["bdr"] == "ZZCM sales-b"
    as_(c, people["sales_b"])
    assert c.put(f"{R}/leads/{lead['id']}", json={"owner_id": people["sales_a"]["id"]}).status_code == 403    # a BDR can't hand leads around
    as_(c, people["sales_view"])
    assert any(l["id"] == lead["id"] for l in c.get(f"{R}/leads").json()) and c.put(f"{R}/leads/{lead['id']}", json={"status": "New"}).status_code == 403
    as_(c, people["mgr"])
    assert c.delete(f"{R}/leads/{lead['id']}").status_code == 200 and c.get(f"{R}/leads/{lead['id']}").status_code == 404


def test_converting_a_lead_creates_the_account_and_opportunity(client, people):
    c = client
    lead = new_lead(c, people["sales_a"], status="Qualified", interested_in="Needs HRMS")
    as_(c, people["sales_a"])
    r = c.post(f"{R}/leads/{lead['id']}/convert", json={"deal_value": 120000, "expected_close_date": "2026-12-31"})
    assert r.status_code == 200, r.text
    out = r.json()
    opp, acc = out["opportunity"], out["account_id"]
    assert out["account_created"] and out["lead"]["status"] == "Converted" and out["lead"]["converted"] and out["lead"]["converted_opp_id"] == opp["id"]
    assert opp["code"].startswith("O-") and opp["stage"] == "Discovery" and opp["probability"] == 10 and opp["deal_value"] == 120000.0 and opp["weighted_value"] == 12000.0
    assert opp["client_id"] == acc and opp["bdr"] == "ZZCM sales-a" and opp["notes"] == "Needs HRMS" and opp["lead_source"] == "Referral"
    account = c.get(f"{R}/clients/{acc}").json()
    assert account["code"].startswith("A-") and account["name"] == lead["company_name"] and account["account_type"] == "Prospect" and account["location"] == "Chennai"
    assert c.post(f"{R}/leads/{lead['id']}/convert", json={}).status_code == 409                              # once only
    assert c.put(f"{R}/leads/{lead['id']}", json={"status": "New"}).status_code == 400                         # a converted lead is managed on its opportunity
    assert c.delete(f"{R}/leads/{lead['id']}").status_code == 403
    as_(c, people["mgr"])
    assert c.delete(f"{R}/leads/{lead['id']}").status_code == 409
    # an existing account (same name, any case) is reused; unqualified or company-less leads can't convert
    again = new_lead(c, people["sales_a"], company_name=lead["company_name"].upper(), email=f"{TAG}-x-{uniq()}@example.com", phone="")
    as_(c, people["sales_a"])
    r2 = c.post(f"{R}/leads/{again['id']}/convert", json={"opp_name": "Second deal"})
    assert r2.status_code == 200 and r2.json()["account_created"] is False and r2.json()["account_id"] == acc and r2.json()["opportunity"]["opp_name"] == "Second deal"
    bad = new_lead(c, people["sales_a"], status="Unqualified")
    assert c.post(f"{R}/leads/{bad['id']}/convert", json={}).status_code == 400
    nameless = c.post(f"{R}/leads", json={"contact_person": "Someone", "phone": f"9{uniq().zfill(9)[-9:]}"}).json()
    assert c.post(f"{R}/leads/{nameless['id']}/convert", json={}).status_code == 400
    assert any("converted" in a["notes"] for a in c.get(f"{R}/activity", params={"client_id": acc}).json())


def test_opportunity_stages_probability_and_closing_rules(client, people):
    c = client
    opp = new_opp(c, people["sales_a"], deal_value=200000)
    assert opp["stage"] == "Discovery" and opp["weighted_value"] == 20000.0 and opp["opp_name"].startswith("ZZCM Opp Co")
    as_(c, people["sales_a"])
    for stage, prob in (("Demo Completed", 30), ("Pricing/POC Discussion", 50), ("Qualified", 70)):
        r = c.put(f"{R}/opportunities/{opp['id']}", json={"stage": stage}).json()
        assert r["stage"] == stage and r["probability"] == prob and r["weighted_value"] == 200000 * prob / 100
    assert c.put(f"{R}/opportunities/{opp['id']}", json={"stage": "Nope"}).status_code == 400
    assert c.post(f"{R}/opportunities", json={"company_name": "ZZCM x", "stage": "Closed Won", "deal_value": 5}).status_code == 400       # a deal is opened first
    # Closed Won needs a value
    blank = new_opp(c, people["sales_a"], deal_value=None)
    assert blank["deal_value"] is None and blank["weighted_value"] == 0.0
    as_(c, people["sales_a"])
    assert c.put(f"{R}/opportunities/{blank['id']}", json={"stage": "Closed Won"}).status_code == 400
    won = c.put(f"{R}/opportunities/{blank['id']}", json={"stage": "Closed Won", "deal_value": 50000}).json()
    assert won["stage"] == "Closed Won" and won["probability"] == 100 and won["closed_at"] and c.get(f"{R}/clients/{won['client_id']}").json()["account_type"] == "Active Client"
    lost = c.put(f"{R}/opportunities/{opp['id']}", json={"stage": "Closed Lost"}).json()
    assert lost["probability"] == 0 and lost["weighted_value"] == 0.0
    # reopening is a manager's call; another BDR can't touch it; negative values refused
    assert c.put(f"{R}/opportunities/{opp['id']}", json={"stage": "Discovery"}).status_code == 403
    as_(c, people["sales_b"])
    assert c.get(f"{R}/opportunities/{opp['id']}").status_code == 404
    as_(c, people["mgr"])
    assert c.put(f"{R}/opportunities/{opp['id']}", json={"stage": "Discovery"}).json()["closed_at"] is None
    assert c.put(f"{R}/opportunities/{opp['id']}", json={"deal_value": -5}).status_code == 400
    assert {o["id"] for o in c.get(f"{R}/opportunities", params={"open_only": True}).json()} >= {opp["id"]} and not any(o["id"] == blank["id"] for o in c.get(f"{R}/opportunities", params={"open_only": True}).json())
    assert [o["id"] for o in c.get(f"{R}/opportunities", params={"client_id": opp["client_id"]}).json()] == [opp["id"]]
    assert c.delete(f"{R}/opportunities/{opp['id']}").status_code == 200


def test_closed_won_deal_goes_through_after_sales_without_a_proposal(client, people):
    c = client
    opp = new_opp(c, people["sales_a"], deal_value=300000)
    as_(c, people["sales_a"])
    po = {"po_reference": "PO-DIRECT", "po_date": "2026-02-01", "start_date": "2026-02-01", "end_date": "2026-12-31", "contract_value": None}
    assert c.post(f"{R}/opportunities/{opp['id']}/contract", json=po).status_code == 403                          # managers book POs
    as_(c, people["mgr"])
    assert c.post(f"{R}/opportunities/{opp['id']}/contract", json=po).status_code == 400                          # not Closed Won yet
    assert c.put(f"{R}/opportunities/{opp['id']}", json={"stage": "Closed Won"}).status_code == 200
    assert c.post(f"{R}/opportunities/{opp['id']}/contract", json={**po, "po_reference": " "}).status_code == 400
    k = c.post(f"{R}/opportunities/{opp['id']}/contract", json=po)
    assert k.status_code == 200, k.text
    k = k.json()
    assert k["status"] == "DRAFT" and k["contract_value"] == 300000.0 and k["opportunity_id"] == opp["id"] and k["proposal_id"] is None
    assert c.post(f"{R}/opportunities/{opp['id']}/contract", json=po).status_code == 409
    assert c.get(f"{R}/opportunities/{opp['id']}").json()["contract_id"] == k["id"]
    assert c.put(f"{R}/opportunities/{opp['id']}", json={"stage": "Discovery"}).status_code == 400                  # a contract exists: can't reopen
    eng = c.post(f"{R}/contracts/{k['id']}/engagement", json={})
    assert eng.status_code == 200 and eng.json()["status"] == "ACTIVE"
    as_(c, people["sales_a"])
    assert c.get(f"{R}/contracts/{k['id']}").status_code == 200                                                    # the BDR sees the contract of their own deal
    as_(c, people["sales_b"])
    assert c.get(f"{R}/contracts/{k['id']}").status_code == 404
    inv = posted_invoice(c, people, k, "2026-02", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=1000)
    assert inv["status"] == "POSTED"
    # booking a PO on an approved proposal also closes its opportunity as Won
    _, prop, k2 = booked_contract(c, people)
    opp2 = c.get(f"{R}/opportunities/{prop['opportunity_id']}").json() if as_(c, people["mgr"]) else None
    assert opp2["stage"] == "Closed Won" and opp2["deal_value"] == 365000.0 and opp2["contract_id"] == k2["id"]


def test_follow_up_cadence_steps_feed_the_activity_log(client, people):
    c = client
    opp = new_opp(c, people["sales_a"])
    as_(c, people["sales_a"])
    f = c.post(f"{R}/followups", json={"opportunity_id": opp["id"]})
    assert f.status_code == 200, f.text
    f = f.json()
    assert f["code"].startswith("F-") and f["company_name"] == opp["account_name"] and f["opportunity_stage"] == "Discovery" and f["current_step"] == "Not started"
    assert [s["label"] for s in f["steps"]] == ["Email 1", "Call 1", "Email 2", "Call 2", "Email 3", "Call 3", "Email 4", "Call 4", "Email 5", "Call 5"]
    assert c.post(f"{R}/followups", json={"opportunity_id": opp["id"]}).status_code == 409                 # one cadence per opportunity
    today = datetime.now().strftime("%Y-%m-%d")
    r = c.put(f"{R}/followups/{f['id']}/steps/1", json={"date": today, "outcome": "Completed"})
    assert r.status_code == 200 and r.json()["steps"][0] == {"step_no": 1, "label": "Email 1", "date": today, "outcome": "Completed"} and r.json()["current_step"] == "Email 1"
    acts = [a for a in c.get(f"{R}/activity", params={"client_id": opp["client_id"]}).json() if a["followup_id"] == f["id"]]
    assert len(acts) == 1 and acts[0]["activity_type"] == "Email" and acts[0]["outcome"] == "Completed" and acts[0]["log_date"] == today and acts[0]["from_cadence"]
    # the call that follows; an outcome with no date means today
    assert c.put(f"{R}/followups/{f['id']}/steps/2", json={"outcome": "No Response"}).json()["steps"][1]["date"] == today
    acts = [a for a in c.get(f"{R}/activity", params={"client_id": opp["client_id"]}).json() if a["followup_id"] == f["id"]]
    assert sorted(a["activity_type"] for a in acts) == ["Call", "Email"]
    assert c.put(f"{R}/followups/{f['id']}/steps/3", json={"date": "2030-01-01", "outcome": "Pending"}).json()["current_step"] == "Call 1"      # a scheduled, not-yet-done touch is not "current"
    assert len([a for a in c.get(f"{R}/activity", params={"client_id": opp["client_id"]}).json() if a["followup_id"] == f["id"]]) == 2          # Pending isn't an activity yet
    # changing the outcome updates the log entry, clearing removes it
    c.put(f"{R}/followups/{f['id']}/steps/1", json={"date": today, "outcome": "Rescheduled"})
    assert [a["outcome"] for a in c.get(f"{R}/activity", params={"client_id": opp["client_id"], "activity_type": "Email"}).json() if a["followup_id"] == f["id"]] == ["Rescheduled"]
    cleared = c.put(f"{R}/followups/{f['id']}/steps/1", json={}).json()
    assert cleared["steps"][0]["date"] is None and cleared["steps"][0]["outcome"] is None
    assert not [a for a in c.get(f"{R}/activity", params={"client_id": opp["client_id"], "activity_type": "Email"}).json() if a["followup_id"] == f["id"]]
    # validation and the last step
    assert c.put(f"{R}/followups/{f['id']}/steps/11", json={"date": today}).status_code == 400 and c.put(f"{R}/followups/{f['id']}/steps/1", json={"outcome": "Maybe"}).status_code == 400
    assert c.put(f"{R}/followups/{f['id']}/steps/1", json={"date": "04/11/26x"}).status_code == 400
    assert c.put(f"{R}/followups/{f['id']}/steps/10", json={"date": today, "outcome": "Completed"}).json()["current_step"] == "Sequence Complete"
    assert c.put(f"{R}/followups/{f['id']}", json={"notes": "Wants a demo", "contact_person": "Mala R"}).json()["notes"] == "Wants a demo"
    # the opportunity's last activity date moves forward
    assert c.get(f"{R}/opportunities/{opp['id']}").json()["last_activity_date"] == today
    # another BDR can't see or touch it; the cadence activity can't be edited as a plain row
    as_(c, people["sales_b"])
    assert c.get(f"{R}/followups/{f['id']}").status_code == 404 and c.put(f"{R}/followups/{f['id']}/steps/1", json={"date": today}).status_code == 404
    as_(c, people["sales_a"])
    row = [a for a in c.get(f"{R}/activity").json() if a["followup_id"] == f["id"]][0]
    assert c.put(f"{R}/activity/{row['id']}", json={"notes": "x"}).status_code == 400 and c.delete(f"{R}/activity/{row['id']}").status_code == 400
    assert c.delete(f"{R}/followups/{f['id']}").status_code == 200
    assert not [a for a in c.get(f"{R}/activity").json() if a["followup_id"] == f["id"]] or all(a["followup_id"] is None for a in c.get(f"{R}/activity").json() if a["id"] == row["id"])


def test_activity_log_and_overview_counts(client, people):
    c = client
    as_(c, people["sales_a"])
    base = c.get(f"{R}/dashboard").json()["crm"]
    acc = new_client(c, people["mgr"])
    as_(c, people["sales_a"])
    today = datetime.now().strftime("%Y-%m-%d")
    mk = lambda **kw: c.post(f"{R}/activity", json={"company_name": acc["name"], **kw})   # noqa: E731
    e = mk(activity_type="Email", outcome="Completed", notes="Intro mail")
    assert e.status_code == 200 and e.json()["code"].startswith("AL-") and e.json()["client_id"] == acc["id"] and e.json()["log_date"] == today and e.json()["bdr"] == "ZZCM sales-a"
    assert mk(activity_type="Call", outcome="Completed").status_code == 200 and mk(activity_type="Call", outcome="No Response").status_code == 200
    assert mk(activity_type="WhatsApp", outcome="Completed").status_code == 200
    old = mk(activity_type="Call", outcome="Completed", log_date="2020-01-01").json()
    assert mk(activity_type="Fax").status_code == 400 and mk(outcome="Maybe").status_code == 400 and mk(log_date="31/02/2026").status_code == 400
    assert c.post(f"{R}/activity", json={"activity_type": "Call"}).status_code == 400                       # which company?
    ov = c.get(f"{R}/dashboard").json()["crm"]
    assert ov["emails_today"] - base["emails_today"] == 1 and ov["calls_today"] - base["calls_today"] == 1       # only Completed Email / Call count; WhatsApp and No Response don't
    mine = next(b for b in ov["bdr_activity_today"] if b["bdr"] == "ZZCM sales-a")
    before = next((b for b in base["bdr_activity_today"] if b["bdr"] == "ZZCM sales-a"), {"emails": 0, "calls": 0})
    assert mine["emails"] - before["emails"] == 1 and mine["calls"] - before["calls"] == 1
    # filters
    assert [a["id"] for a in c.get(f"{R}/activity", params={"date_to": "2020-12-31", "client_id": acc["id"]}).json()] == [old["id"]]
    assert {a["activity_type"] for a in c.get(f"{R}/activity", params={"client_id": acc["id"], "activity_type": "Call"}).json()} == {"Call"}
    # edit / delete own; others can't
    assert c.put(f"{R}/activity/{old['id']}", json={"notes": "fixed", "outcome": "Skipped"}).json()["outcome"] == "Skipped"
    as_(c, people["sales_b"])
    assert c.put(f"{R}/activity/{old['id']}", json={"notes": "x"}).status_code == 404 and not any(a["id"] == old["id"] for a in c.get(f"{R}/activity").json())
    as_(c, people["sales_a"])
    assert c.delete(f"{R}/activity/{old['id']}").status_code == 200
    # a manager can log for a BDR; a BDR can't log for someone else
    as_(c, people["mgr"])
    assert c.post(f"{R}/activity", json={"company_name": acc["name"], "activity_type": "Email", "owner_id": people["sales_b"]["id"]}).json()["bdr"] == "ZZCM sales-b"
    as_(c, people["sales_a"])
    assert c.post(f"{R}/activity", json={"company_name": acc["name"], "owner_id": people["sales_b"]["id"]}).status_code == 403


def test_overview_numbers_follow_the_sheet(client, people):
    c = client
    as_(c, people["mgr"])
    base = c.get(f"{R}/dashboard").json()["crm"]
    base_mine = c.get(f"{R}/dashboard", params={"owner_id": people["sales_a"]["id"]}).json()["crm"]
    assert [s["stage"] for s in base["pipeline_by_stage"]] == ["Discovery", "Demo Completed", "Pricing/POC Discussion", "Qualified", "Closed Won", "Closed Lost"]
    assert [s["source"] for s in base["leads_by_source"]][:3] == ["Website", "Referral", "Cold Call"] and [s["status"] for s in base["lead_status"]] == ["New", "Contacted", "Working", "Qualified", "Unqualified", "Converted"]
    o1 = new_opp(c, people["sales_a"], deal_value=100000)
    o2 = new_opp(c, people["sales_a"], deal_value=50000, stage="Qualified")
    o3 = new_opp(c, people["sales_a"], deal_value=30000)
    as_(c, people["sales_a"])
    assert c.put(f"{R}/opportunities/{o3['id']}", json={"stage": "Closed Won"}).status_code == 200
    o4 = new_opp(c, people["sales_a"], deal_value=1000)
    as_(c, people["sales_a"])
    c.put(f"{R}/opportunities/{o4['id']}", json={"stage": "Closed Lost"})
    new_lead(c, people["sales_a"], source="Cold Call", status="Working")
    as_(c, people["mgr"])
    ov = c.get(f"{R}/dashboard").json()["crm"]
    assert ov["open_opportunities"] - base["open_opportunities"] == 2 and ov["pipeline_value"] - base["pipeline_value"] == 150000.0
    assert ov["weighted_pipeline"] - base["weighted_pipeline"] == 100000 * 0.1 + 50000 * 0.7
    assert ov["closed_won_value"] - base["closed_won_value"] == 30000.0 and ov["closed_won_count"] - base["closed_won_count"] == 1
    assert ov["total_leads"] - base["total_leads"] == 1 and ov["total_accounts"] - base["total_accounts"] >= 4
    by = {s["stage"]: s for s in ov["pipeline_by_stage"]}
    assert by["Qualified"]["count"] - {s["stage"]: s for s in base["pipeline_by_stage"]}["Qualified"]["count"] == 1
    # win rate = won / (won + lost), null (not 0) when nothing is closed
    assert ov["win_rate_pct"] == round(ov["closed_won_count"] * 100 / (ov["closed_won_count"] + sum(s["count"] for s in ov["pipeline_by_stage"] if s["stage"] == "Closed Lost")), 1)
    # one BDR's view (the sheet keeps a workbook per BDR) and scoping for a BDR
    mine = c.get(f"{R}/dashboard", params={"owner_id": people["sales_a"]["id"]}).json()["crm"]
    assert mine["owner_id"] == people["sales_a"]["id"] and mine["open_opportunities"] - base_mine["open_opportunities"] == 2 and mine["closed_won_count"] - base_mine["closed_won_count"] == 1
    assert mine["pipeline_value"] - base_mine["pipeline_value"] == 150000.0
    as_(c, people["sales_b"])
    theirs = c.get(f"{R}/dashboard").json()["crm"]
    assert theirs["open_opportunities"] == 0 and theirs["closed_won_value"] == 0 and theirs["win_rate_pct"] is None and theirs["pipeline_value"] == 0
    # Accounts-only people see no CRM block
    as_(c, people["acct"])
    d = c.get(f"{R}/dashboard").json()
    assert d["crm"] is None and d["aging"] is not None


def test_alerts_for_due_follow_ups_and_stale_opportunities(client, people):
    c = client
    opp = new_opp(c, people["sales_a"])
    as_(c, people["sales_a"])
    f = c.post(f"{R}/followups", json={"opportunity_id": opp["id"]}).json()
    c.put(f"{R}/followups/{f['id']}/steps/2", json={"date": "2020-01-01"})                                   # a call that was due long ago, no outcome
    db(c, "UPDATE opportunities SET last_activity_date = '2020-01-01' WHERE id = %s", (opp["id"],))
    alerts = c.get(f"{R}/alerts").json()
    due = [a for a in alerts if a["kind"] == "FOLLOWUP" and a.get("followup_id") == f["id"]]
    assert due and due[0]["severity"] == "high" and "Call 1" in due[0]["message"] and "overdue" in due[0]["message"]
    assert any(a["kind"] == "OPPORTUNITY_STALE" and a.get("opportunity_id") == opp["id"] for a in alerts)
    c.put(f"{R}/followups/{f['id']}/steps/2", json={"date": "2020-01-01", "outcome": "Completed"})            # done: the call is no longer due, and the next touch was scheduled automatically (in the past here)
    due2 = [a for a in c.get(f"{R}/alerts").json() if a["kind"] == "FOLLOWUP" and a.get("followup_id") == f["id"]]
    assert len(due2) == 1 and "Email 2" in due2[0]["message"]
    as_(c, people["sales_b"])
    assert not any(a.get("opportunity_id") == opp["id"] for a in c.get(f"{R}/alerts").json())


def test_follow_up_reminder_digest_lists_due_touches_once_a_day(client, people):
    from app.services import cm_reminders
    c = client
    sent = []
    cm_reminders._send = lambda to, subject, html: sent.append((to, subject, html))
    opp = new_opp(c, people["sales_a"])
    as_(c, people["sales_a"])
    f = c.post(f"{R}/followups", json={"opportunity_id": opp["id"]}).json()
    c.put(f"{R}/followups/{f['id']}/steps/1", json={"date": "2020-01-01"})
    monday = datetime(2030, 1, 7, 9, 30, tzinfo=timezone.utc).astimezone(cm_reminders.APP_TIMEZONE).replace(hour=9, minute=30)
    assert monday.weekday() == 0
    n = c.portal.call(lambda: cm_reminders.send_followup_digests(monday))
    mine = [m for m in sent if m[0] == people["sales_a"]["email"]]
    assert n >= 1 and len(mine) == 1 and "Follow-ups due" in mine[0][1] and "Email 1" in mine[0][2] and opp["account_name"] in mine[0][2]
    c.portal.call(lambda: cm_reminders.send_followup_digests(monday))
    assert len([m for m in sent if m[0] == people["sales_a"]["email"]]) == 1                      # same day: not again
    assert c.portal.call(lambda: cm_reminders.send_followup_digests(monday.replace(day=monday.day + 5))) == 0      # weekends are quiet
    assert c.portal.call(lambda: cm_reminders.send_followup_digests(monday.replace(hour=6))) == 0                   # before the reminder time
    db(c, "DELETE FROM reminder_log WHERE kind IN ('cm_followup', 'cm_receivables') AND date = %s", (monday.strftime("%Y-%m-%d"),))


def test_public_web_form_creates_unassigned_website_leads_with_guards(client, people):
    from app.services import cm_webform
    c = client
    cm_webform._hits.clear()
    page = c.get("/api/public/lead-form")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"] and "name=website" in page.text
    u = uniq()
    body = {"name": "Web Visitor", "company": f"ZZCM Web Co {u}", "email": f"{TAG}-web-{u}@example.com", "phone": "", "message": "Need a portal built", "website": ""}
    c.cookies.clear()
    assert c.post("/api/public/lead-form", json=body).status_code == 200
    row = db(c, "SELECT * FROM leads WHERE email_norm = %s", (body["email"],), fetch_one=True)
    assert row and row["source"] == "Website" and row["lead_status"] == "New" and row["owner_id"] is None and row["code"].startswith("L-") and row["interested_in"] == "Need a portal built"
    act = db(c, "SELECT bdr_label, notes FROM activity_log WHERE lead_id = %s ORDER BY id", (row["id"],), fetch_all=True)
    assert any("Need a portal built" in a["notes"] for a in act) and act[0]["bdr_label"] == "Web form"
    as_(c, people["mgr"])
    assert any(l["id"] == row["id"] for l in c.get(f"{R}/leads").json())
    as_(c, people["sales_b"])
    assert not any(l["id"] == row["id"] for l in c.get(f"{R}/leads").json())
    c.cookies.clear()
    assert c.post("/api/public/lead-form", json={**body, "message": "Following up"}).status_code == 200
    assert db(c, "SELECT COUNT(*) AS n FROM leads WHERE email_norm = %s", (body["email"],), fetch_one=True)["n"] == 1
    assert any("Following up" in a["notes"] for a in db(c, "SELECT notes FROM activity_log WHERE lead_id = %s", (row["id"],), fetch_all=True))
    bot = {**body, "email": f"{TAG}-bot-{u}@example.com", "website": "http://spam"}
    assert c.post("/api/public/lead-form", json=bot).status_code == 200
    assert db(c, "SELECT COUNT(*) AS n FROM leads WHERE email_norm = %s", (bot["email"],), fetch_one=True)["n"] == 0
    assert c.post("/api/public/lead-form", json={**body, "name": ""}).status_code == 400
    assert c.post("/api/public/lead-form", json={**body, "email": "", "phone": ""}).status_code == 400
    assert c.post("/api/public/lead-form", json={**body, "email": "not-an-email"}).status_code == 400
    cm_webform._hits.clear()
    codes = [c.post("/api/public/lead-form", json={**body, "name": ""}).status_code for _ in range(cm_webform.RATE_LIMIT + 1)]
    assert codes[-1] == 429
    cm_webform._hits.clear()


def _workbook(rows_by_sheet: dict) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in rows_by_sheet.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO(); wb.save(buf)
    return buf.getvalue()

def test_import_the_sales_crm_workbook_is_previewable_idempotent_and_tolerant(client, people):
    c = client
    u = uniq()
    co1, co2, co3 = f"ZZCM Imp Alpha {u}", f"ZZCM Imp Beta {u}", f"ZZCM Imp Gamma {u}"
    wb = _workbook({
        "Lists": [["Lead Source", "Lead Status"], ["Website", "New"]],
        "Overview": [["SALES CRM — OVERVIEW DASHBOARD"], ["Total Leads", 74]],
        "Accounts": [["ACCOUNTS (Client Companies)"], ["One row per company."], ["Account ID", "Company Name", "Industry", "Location", "Website", "Primary Contact", "Phone", "Email", "Account Type", "Account Owner", "Created Date", "Notes"],
                     ["A-001", co1, "Construction", "Coimbatore", "https://a.example", "Ganesh", "9344900018", "g@example.com", "Prospect", "Sales", "02-09-2026", "first note"],
                     ["A-002", co1, "Construction", "Coimbatore", None, None, None, None, "Prospect", "Sales", "02-09-2026", None],
                     ["A-003", co2, "Underwater Basket Weaving", "Chennai", None, None, "7845746355", None, "Active Client", "Sales Team", "2026-09-03", None]],
        "Leads": [["LEADS"], ["Every new prospect starts here."], ["Lead ID", "Company Name", "Contact Person", "Phone", "Email", "Location", "Lead Source", "Lead Status", "Date Added", "BDR Name", "Converted to Opportunity?", "Interested In / Notes", "Next Action"],
                  ["L-001", co1, "Ganesh", "9344900018", "g@example.com", "Sivaganga", "Cold Call", "Qualified ", "2026-08-01", "ZZCM sales-a", "Yes", "ERP", "Call Mon"],
                  ["L-002", co3, None, "98765 43210", None, "Chennai", "Smoke signal", "Whatever", "25-Aug-2026", "Nobody Known", None, None, None],
                  ["L-003", co3, None, "98765 43210", None, "Chennai", "Cold Call", "Contacted", "4-11-2026", "Nobody Known", None, None, None],
                  ["L-004", None, None, None, None, None, "Cold Call", "New", None, None, None, None, None]],
        "Opportunities": [["OPPORTUNITIES"], ["A lead becomes an Opportunity ..."], ["Opportunity ID", "Company Name", "Opp Name", "Contact Person", "Stage", "Deal Value (INR)", "Probability %", "Weighted Value (INR)", "Expected Close Date",
                                                                                   "Lead Source", "BDR Name", "Created Date", "Last Activity Date", "Next Action", "Notes"],
                          ["O-001", co1, f"{co1} - Aug 26", "Ganesh", "Demo Completed", "1,19,988", "30%", 0, "2026-08-27", "Cold Call", "ZZCM sales-a", "2026-07-27", "2026-08-18", "2nd demo", "(Done)"],
                          ["O-002", co3, f"{co3} - Aug 26", "—", "Pricing/POC Discussion", "core", None, None, None, "Cold Call", "ZZCM sales-a", None, None, None, None]],
        "Follow-ups": [["FOLLOW-UP CADENCE TRACKER"], ["Standard cadence ..."], ["Company / Contact", None, None, None, None, "Email 1", None, "Call 1", None, "Email 2", None, "Call 2", None, "Email 3", None, "Call 3", None, "Email 4", None, "Call 4", None, "Email 5", None, "Call 5", None, "Overall"],
                       ["Follow-up ID", "Company Name", "Contact Person", "BDR Name", "Opportunity Stage (ref)"] + ["Date", "Outcome"] * 10 + ["Current Step", "Notes"],
                       ["F-001", co1, "Ganesh", "ZZCM sales-a", None, "2026-08-25", "Completed", "2026-08-27", "Completed", "2026-09-17", "No Response", None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, "Call 1", "busy"]],
        "Activity Log": [["Every email and call gets its own row here."], ["Log ID", "Date", "BDR Name", "Company Name", "Activity Type", "Outcome", "Notes"],
                         ["AL-001", "25-Aug-2026", "ZZCM sales-a", co1, "Email", "Completed", "Email 1 — cadence step"],
                         ["AL-002", "27-Aug-2026", "ZZCM sales-a", co1, "Call", "Completed", None],
                         ["AL-003", "27-Aug-2026", "ZZCM sales-a", co1, "Call", "Completed", None],
                         ["AL-004", "not a date", "ZZCM sales-a", co1, "Call", "Completed", None]],
    })
    as_(c, people["mgr"])
    def post(apply, **params):
        return c.post(f"{R}/import", params={"apply": apply, **params}, files={"file": ("Sales_CRM.xlsx", wb, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    # preview: reports what would happen, writes nothing
    pre = post(False)
    assert pre.status_code == 200, pre.text
    by = {s["sheet"]: s for s in pre.json()["sheets"]}
    assert pre.json()["applied"] is False and by["Lists"]["kind"] is None and by["Overview"]["kind"] is None
    assert (by["Accounts"]["kind"], by["Accounts"]["rows"], by["Accounts"]["created"], by["Accounts"]["skipped"]) == ("accounts", 3, 2, 1)         # the repeated company counts once
    assert (by["Leads"]["created"], by["Leads"]["skipped"]) == (2, 2) and by["Leads"]["errors"][0]["row"] == 4                                   # one duplicate (same company + phone), one empty row
    assert db(c, "SELECT COUNT(*) AS n FROM clients WHERE name LIKE %s", (f"%{u}%",), fetch_one=True)["n"] == 0
    # apply
    done = post(True).json()
    by = {s["sheet"]: s for s in done["sheets"]}
    assert by["Accounts"]["created"] == 2 and by["Opportunities"]["created"] == 2 and by["Follow-ups"]["created"] == 1 and by["Activity Log"]["created"] == 2 and by["Activity Log"]["skipped"] == 2
    acc = db(c, "SELECT * FROM clients WHERE name = %s", (co1,), fetch_one=True)
    assert acc["code"].startswith("A-") and acc["industry"] == "Construction" and acc["location"] == "Coimbatore" and acc["created_at"].startswith("2026-09-02") and acc["owner_label"] == "Sales"
    assert db(c, "SELECT industry, account_type FROM clients WHERE name = %s", (co2,), fetch_one=True) == {"industry": "Other", "account_type": "Active Client"}     # unknown industry -> Other
    leads = db(c, "SELECT * FROM leads WHERE company_name LIKE %s ORDER BY id", (f"%{u}%",), fetch_all=True)
    assert len(leads) == 2
    l1, l2 = leads
    assert (l1["lead_status"], l1["source"], l1["date_added"], l1["owner_id"], l1["interested_in"]) == ("Qualified", "Cold Call", "2026-08-01", people["sales_a"]["id"], "ERP")      # "Qualified " trimmed, BDR matched to the user
    assert (l2["lead_status"], l2["source"], l2["date_added"], l2["owner_id"], l2["bdr_label"]) == ("New", "Other", "2026-08-25", None, "Nobody Known")                    # bad dropdown values fall back, unknown BDR kept as text
    opps = {o["opp_name"]: o for o in db(c, "SELECT * FROM opportunities WHERE opp_name LIKE %s", (f"%{u}%",), fetch_all=True)}
    o1 = opps[f"{co1} - Aug 26"]
    assert float(o1["deal_value"]) == 119988.0 and o1["stage"] == "Demo Completed" and o1["expected_close_date"] == "2026-08-27" and o1["created_date"] == "2026-07-27" and o1["owner_id"] == people["sales_a"]["id"]
    assert opps[f"{co3} - Aug 26"]["deal_value"] is None                                                                                  # "core" isn't a number
    fu = db(c, "SELECT * FROM followups WHERE company_name = %s", (co1,), fetch_one=True)
    steps = {r["step_no"]: r for r in db(c, "SELECT * FROM followup_steps WHERE followup_id = %s", (fu["id"],), fetch_all=True)}
    assert fu["owner_id"] == people["sales_a"]["id"] and fu["opportunity_id"] == o1["id"] and (steps[1]["step_date"], steps[1]["outcome"]) == ("2026-08-25", "Completed") and steps[3]["outcome"] == "No Response" and len(steps) == 3
    acts = db(c, "SELECT * FROM activity_log WHERE company_name = %s ORDER BY id", (co1,), fetch_all=True)
    assert [(a["log_date"], a["activity_type"]) for a in acts] == [("2026-08-25", "Email"), ("2026-08-27", "Call")] and acts[0]["client_id"] == acc["id"]
    # re-running changes nothing; a selected sheet only
    again = {s["sheet"]: s for s in post(True).json()["sheets"]}
    assert all(again[n]["created"] == 0 for n in ("Accounts", "Leads", "Opportunities", "Follow-ups", "Activity Log"))
    one = {s["sheet"]: s for s in post(False, sheets="Leads").json()["sheets"]}
    assert one["Leads"]["rows"] == 4 and one["Accounts"]["note"] == "Not selected"
    # a BDR sees what was assigned to them; the manager imported the rest
    as_(c, people["sales_a"])
    assert any(o["opp_name"] == f"{co1} - Aug 26" for o in c.get(f"{R}/opportunities").json())
    assert c.post(f"{R}/import", files={"file": ("x.xlsx", wb, "application/octet-stream")}).status_code == 403                   # managers only
    as_(c, people["mgr"])
    assert c.post(f"{R}/import", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400
    assert c.post(f"{R}/import", files={"file": ("x.xlsx", b"not a workbook", "application/octet-stream")}).status_code == 400
    # one sheet as CSV works too
    csv_bytes = ("Lead ID,Company Name,Contact Person,Phone,Email,Location,Lead Source,Lead Status,Date Added,BDR Name,Converted to Opportunity?,Interested In / Notes,Next Action\n"
                 f"L-9,ZZCM Csv Co {u},,9000000099,,Madurai,Referral,Contacted,2026-10-01,ZZCM sales-b,,,\n").encode()
    r = c.post(f"{R}/import", params={"apply": True}, files={"file": ("leads.csv", csv_bytes, "text/csv")})
    assert r.status_code == 200 and r.json()["sheets"][0]["created"] == 1


def test_crm_exports_use_the_sheet_headings_and_round_trip(client, people):
    c = client
    lead = new_lead(c, people["sales_a"], company_name=f"=SUM(1+1) ZZCM {uniq()}", status="Working")
    opp = new_opp(c, people["sales_a"])
    as_(c, people["sales_a"])
    f = c.post(f"{R}/followups", json={"opportunity_id": opp["id"]}).json()
    c.put(f"{R}/followups/{f['id']}/steps/1", json={"date": "2026-08-25", "outcome": "Completed"})
    head = lambda name: c.get(f"{R}/reports/{name}.csv").content.decode("utf-8-sig").splitlines()[0]   # noqa: E731
    assert head("leads") == "Lead ID,Company Name,Contact Person,Phone,Email,Location,Lead Source,Lead Status,Date Added,BDR Name,Converted to Opportunity?,Interested In / Notes,Next Action"
    assert head("accounts") == "Account ID,Company Name,Industry,Location,Website,Primary Contact,Phone,Email,Account Type,Account Owner,Created Date,Notes"
    assert head("opportunities").startswith("Opportunity ID,Company Name,Opp Name,Contact Person,Stage,Deal Value (INR),Probability %,Weighted Value (INR),Expected Close Date")
    assert head("followups").startswith("Follow-up ID,Company Name,Contact Person,BDR Name,Opportunity Stage (ref),Email 1 Date,Email 1 Outcome,Call 1 Date") and head("followups").endswith("Current Step,Notes")
    assert head("activity") == "Log ID,Date,BDR Name,Company Name,Activity Type,Outcome,Notes"
    body = c.get(f"{R}/reports/leads.csv").content.decode("utf-8-sig")
    assert f"'{lead['company_name']}" in body                                                              # formula-looking text is defused
    assert "Working" in body and c.get(f"{R}/reports/followups.csv").content.decode("utf-8-sig").count("2026-08-25,Completed") >= 1
    # BDRs export only their own rows; Accounts people can't export CRM data but can export contracts / accounts
    as_(c, people["sales_b"])
    assert lead["company_name"] not in c.get(f"{R}/reports/leads.csv").content.decode("utf-8-sig")
    as_(c, people["acct"])
    assert c.get(f"{R}/reports/leads.csv").status_code == 403 and c.get(f"{R}/reports/activity.csv").status_code == 403 and c.get(f"{R}/reports/accounts.csv").status_code == 200
    # exported leads import again without creating duplicates
    as_(c, people["mgr"])
    csv_bytes = c.get(f"{R}/reports/leads.csv").content
    r = c.post(f"{R}/import", params={"apply": True}, files={"file": ("leads.csv", csv_bytes, "text/csv")}).json()["sheets"][0]
    assert r["kind"] == "leads" and r["created"] == 0 and r["skipped"] >= 1


def test_cadence_automation_schedules_the_next_touch_and_conversion_starts_the_cadence(client, people):
    from app.services.cm_crm import next_workday
    from datetime import date as _date, timedelta as _td
    c = client
    # converting a lead opens the cadence with Email 1 due today (next working day)
    lead = new_lead(c, people["sales_a"], status="Qualified")
    as_(c, people["sales_a"])
    out = c.post(f"{R}/leads/{lead['id']}/convert", json={}).json()
    fid = out["followup_id"]
    assert fid
    fu = c.get(f"{R}/followups/{fid}").json()
    today = _date.today()
    assert fu["opportunity_id"] == out["opportunity"]["id"] and fu["steps"][0]["outcome"] == "Pending" and fu["steps"][0]["date"] == next_workday(today).isoformat() and fu["current_step"].startswith("Email 1")
    assert c.post(f"{R}/leads/{new_lead(c, people['sales_a'])['id']}/convert", json={"start_cadence": False}).json()["followup_id"] is None
    # doing Email 1 schedules Call 1 two days later, Call 1 schedules Email 2 three days after that, never on a weekend
    d1 = "2026-11-02"                                                                                 # a Monday
    r = c.put(f"{R}/followups/{fid}/steps/1", json={"date": d1, "outcome": "Completed"}).json()
    assert (r["steps"][1]["date"], r["steps"][1]["outcome"]) == ("2026-11-04", "Pending")
    r = c.put(f"{R}/followups/{fid}/steps/2", json={"date": "2026-11-04", "outcome": "No Response"}).json()
    assert (r["steps"][2]["date"], r["steps"][2]["outcome"]) == ("2026-11-09", "Pending")              # Wed + 3 = Saturday -> Monday
    assert next_workday(_date(2026, 11, 7)) == _date(2026, 11, 9) and next_workday(_date(2026, 11, 6)) == _date(2026, 11, 6)
    # an already scheduled / filled next touch is left alone; Pending and Rescheduled don't schedule anything
    c.put(f"{R}/followups/{fid}/steps/4", json={"date": "2026-12-01"})
    r = c.put(f"{R}/followups/{fid}/steps/3", json={"date": "2026-11-09", "outcome": "Completed"}).json()
    assert r["steps"][3]["date"] == "2026-12-01"
    r = c.put(f"{R}/followups/{fid}/steps/5", json={"date": "2026-11-20", "outcome": "Rescheduled"}).json()
    assert r["steps"][5]["date"] is None
    # the dropdown lists endpoint mirrors the sheet's Lists tab
    ls = c.get(f"{R}/lists").json()
    assert ls["lead_statuses"] == ["New", "Contacted", "Working", "Qualified", "Unqualified", "Converted"] and ls["cadence"][0] == "Email 1" and ls["opportunity_stages"][0] == {"stage": "Discovery", "probability": 10}
    ov = c.get(f"{R}/dashboard").json()["crm"]
    assert len(ov["activity_14d"]) == 14 and ov["activity_14d"][-1]["date"] == _date.today().isoformat() and ov["due_followups"] >= 0
