"""Client Management tests (Phase 1: backend).

These run the app in-process (FastAPI TestClient), need no running server, and use the local development database from backend/.env
(the DB user only has rights on that one schema). Everything created is tagged ``zzcm`` and removed afterwards; the migration test works
on prefixed copies (``zzmig_``) of the tables and never touches real ones. Emails are captured, never sent.

Run:  cd backend && venv/bin/python -m pytest tests/test_client_mgmt.py -v
"""

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
    clients = [r["id"] for r in db(c, f"SELECT id FROM clients WHERE name LIKE '{TAG.upper()}%%'", fetch_all=True) or []]
    cm = ", ".join(["%s"] * len(clients)) or "NULL"
    leads = [r["id"] for r in db(c, f"SELECT id FROM leads WHERE created_by IN ({um}) OR owner_id IN ({um}) OR client_id IN ({cm}) OR company_name LIKE '{TAG.upper()}%%'", tuple(users) * 2 + tuple(clients), fetch_all=True) or []]
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
    db(c, f"DELETE FROM contracts WHERE client_id IN ({cm}) OR proposal_id IN ({pm})", tuple(clients) + tuple(props))
    db(c, f"DELETE FROM projects WHERE client_id IN ({cm}) OR name LIKE '{TAG.upper()}%%'", tuple(clients))
    db(c, f"DELETE FROM proposal_items WHERE proposal_id IN ({pm})", tuple(props))
    db(c, f"DELETE FROM proposal_files WHERE proposal_id IN ({pm})", tuple(props))
    db(c, f"DELETE FROM proposals WHERE id IN ({pm})", tuple(props))
    db(c, f"DELETE FROM tenders WHERE lead_id IN ({lm})", tuple(leads))
    db(c, f"DELETE FROM lead_activities WHERE lead_id IN ({lm})", tuple(leads))
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
    body = {"source": "REFERRAL", "company_name": f"ZZCM Lead Co {u}", "contact_name": "Ravi", "phone": f"9{u.zfill(9)[-9:]}", "email": f"{TAG}-lead-{u}@example.com", "estimated_value": 500000, **extra}
    r = c.post(f"{R}/leads", json=body)
    assert r.status_code == 200, r.text
    return r.json()

ITEM = {"description": "Consulting", "quantity": 10, "unit": "days", "rate": 1000, "cost": 600}     # total 10,000, cost 6,000

def qualified_lead(c, who, **lead_extra):
    lead = new_lead(c, who, **lead_extra)
    as_(c, who)
    r = c.post(f"{R}/leads/{lead['id']}/qualify", json={"create_client": True})
    assert r.status_code == 200, r.text
    # the client created from a lead starts with no TDS / retention; give it the usual defaults the invoices should pick up
    assert c.put(f"{R}/clients/{r.json()['client_id']}", json={"default_tds_pct": 2, "default_retention_pct": 5}).status_code == 200
    return r.json()

def new_proposal(c, who, lead, items=None, **extra):
    as_(c, who)
    r = c.post(f"{R}/leads/{lead['id']}/to-proposal", json={"title": f"ZZCM Proposal {uniq()}", "terms": "Net 30", "items": items if items is not None else [ITEM], **extra})
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
    assert run(schema.current_revision(p)) == schema.REVISION == "client_mgmt_001"
    cols = {r["Field"] for r in db(c, f"SHOW COLUMNS FROM {p}clients", fetch_all=True)}
    assert {"code", "gstin", "billing_address", "contact_person", "default_tds_pct", "default_retention_pct"} <= cols
    assert {"client_id", "contract_id"} <= {r["Field"] for r in db(c, f"SHOW COLUMNS FROM {p}projects", fetch_all=True)}
    run(schema.upgrade(p))                                                         # idempotent
    assert run(schema.table_names(p)) == expected and db(c, f"SELECT COUNT(*) AS n FROM {p}schema_revisions", fetch_one=True)["n"] == 1

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

def test_full_chain_lead_to_engagement(client, people):
    c = client
    lead = new_lead(c, people["sales_a"], company_name="ZZCM Chain Co", contact_name=None, phone=None, email=None, estimated_value=None)
    as_(c, people["sales_a"])
    # qualification: exact list of what is missing
    bad = c.post(f"{R}/leads/{lead['id']}/qualify", json={})
    assert bad.status_code == 400
    assert bad.json()["detail"]["missing"] == ["client", "contact name", "phone or email", "estimated value (greater than zero)"] or "client" in bad.json()["detail"]["missing"][0]
    assert set(m.split(" (")[0] for m in bad.json()["detail"]["missing"]) == {"client", "contact name", "phone or email", "estimated value"}
    assert c.put(f"{R}/leads/{lead['id']}", json={"contact_name": "Mr Chain", "email": f"{TAG}-chain-{uniq()}@example.com", "estimated_value": 750000}).status_code == 200
    still = c.post(f"{R}/leads/{lead['id']}/qualify", json={}).json()["detail"]["missing"]
    assert len(still) == 1 and still[0].startswith("client")                                  # only the client is left
    q = c.post(f"{R}/leads/{lead['id']}/qualify", json={"create_client": True, "note": "Budget confirmed"})
    assert q.status_code == 200 and q.json()["stage"] == "QUALIFIED" and q.json()["client_id"]
    client_row = c.get(f"{R}/clients/{q.json()['client_id']}").json()
    assert client_row["name"] == "ZZCM Chain Co" and client_row["code"].startswith("CLI-") and client_row["contact_person"] == "Mr Chain"

    # tender (optional) then proposal
    t = c.post(f"{R}/leads/{lead['id']}/to-tender", json={"reference": "TND-77", "due_date": "2026-12-01"}).json()
    assert t["status"] == "OPEN" and c.get(f"{R}/leads/{lead['id']}").json()["stage"] == "TENDER"
    prop = c.post(f"{R}/leads/{lead['id']}/to-proposal", json={"title": "ZZCM Chain proposal", "items": [ITEM, {"description": "Licences", "quantity": 2, "unit": "nos", "rate": 5000, "cost": 4000}]}).json()
    assert prop["status"] == "DRAFT" and prop["tender_id"] == t["id"] and prop["total_amount"] == 20000.0 and prop["total_cost"] == 14000.0 and prop["margin"] == 6000.0
    assert c.get(f"{R}/leads/{lead['id']}").json()["stage"] == "PROPOSAL"

    # send: the email carries a PDF and a public link
    before = len(PDF_EMAILS)
    sent = c.post(f"{R}/proposals/{prop['id']}/send", json={"to": f"{TAG}-client-{uniq()}@example.com", "message": "Hello!"})
    assert sent.status_code == 200 and sent.json()["status"] == "SENT" and sent.json()["review_status"] == "PENDING" and sent.json()["sent_at"]
    assert wait_for(lambda: len(PDF_EMAILS) == before + 1)
    to, subject, html, pdf, filename, category = PDF_EMAILS[-1]
    token = db(c, "SELECT public_token FROM proposals WHERE id = %s", (prop["id"],), fetch_one=True)["public_token"]
    assert pdf[:4] == b"%PDF" and filename == f"{prop['code']}.pdf" and category == "sales" and f"/api/public/proposals/{token}/page" in html
    assert c.get(f"{R}/proposals/{prop['id']}/pdf").content[:4] == b"%PDF"

    # review by a manager, then the PO
    as_(c, people["mgr"])
    assert c.post(f"{R}/proposals/{prop['id']}/review", json={"status": "APPROVED", "note": "Scope looks right"}).status_code == 200
    po = c.post(f"{R}/proposals/{prop['id']}/book-po", json={**PO, "contract_value": None})
    assert po.status_code == 200, po.text
    k = po.json()
    assert k["status"] == "DRAFT" and k["contract_value"] == 20000.0 and k["estimated_cost"] == 14000.0 and k["margin"] == 6000.0 and k["margin_pct"] == 30.0
    assert (k["po_reference"], k["start_date"], k["end_date"], k["client_id"]) == ("PO-7788", "2026-01-01", "2026-12-31", q.json()["client_id"]) and k["code"].startswith("CTR-")
    assert c.get(f"{R}/proposals/{prop['id']}").json()["status"] == "ACCEPTED"
    assert c.get(f"{R}/leads/{lead['id']}").json()["stage"] == "WON" and c.get(f"{R}/leads/{lead['id']}").json()["won_at"]
    assert c.get(f"{R}/leads/{lead['id']}/tenders").json()[0]["status"] == "WON"

    # engagement: one click creates a project on the project board and the contract goes ACTIVE
    eng = c.post(f"{R}/contracts/{k['id']}/engagement", json={})
    assert eng.status_code == 200 and eng.json()["status"] == "ACTIVE" and eng.json()["engagement_project_id"]
    project = db(c, "SELECT * FROM projects WHERE id = %s", (eng.json()["engagement_project_id"],), fetch_one=True)
    assert project["client_id"] == q.json()["client_id"] and project["contract_id"] == k["id"] and project["status"] == "active" and "ZZCM Chain Co" in project["name"]
    assert c.post(f"{R}/contracts/{k['id']}/engagement", json={}).status_code == 400                       # already active

    # every stage change is in the log with who, when and a note
    log = c.get(f"{R}/leads/{lead['id']}/activities").json()
    changes = [a for a in log if a["kind"] == "STAGE_CHANGE"]
    assert [a["body"].split(" — ")[0] for a in reversed(changes)][:5] == ["Lead created (NEW)", "NEW → QUALIFIED", "QUALIFIED → TENDER", "TENDER → PROPOSAL", "PROPOSAL → WON"]
    assert all(a["by_user_name"] and a["at"] for a in changes) and any("Budget confirmed" in a["body"] for a in changes)


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
    log = c.get(f"{R}/leads/{p1['lead_id']}/activities").json()
    assert any("Client reply" in a["body"] and "asked for changes" in a["body"] and a["by_user_name"] == "Asha (client)" for a in log)
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

def test_duplicate_protection_for_clients_and_leads(client, people):
    c = client
    first = new_client(c, people["sales_a"], name="ZZCM Dup Industries", gstin="29ZZCMDUP0001Z5")
    as_(c, people["sales_a"])
    same_name = c.post(f"{R}/clients", json={"name": "zzcm dup industries"})
    assert same_name.status_code == 409 and same_name.json()["detail"]["can_confirm"] is False and same_name.json()["detail"]["duplicates"][0]["id"] == first["id"]
    same_gstin = c.post(f"{R}/clients", json={"name": "ZZCM Another Name", "gstin": "29zzcmdup0001z5"})
    assert same_gstin.status_code == 409 and same_gstin.json()["detail"]["can_confirm"] is True and same_gstin.json()["detail"]["duplicates"][0]["matched_on"] == ["gstin"]
    assert c.post(f"{R}/clients", json={"name": "ZZCM Another Name", "gstin": "29ZZCMDUP0001Z5", "confirm_duplicate": True}).status_code == 200
    assert c.post(f"{R}/clients", json={"name": "ZZCM Bad", "gstin": "no spaces!"}).status_code == 400
    assert c.post(f"{R}/clients", json={"name": "ZZCM Pct", "default_tds_pct": 120}).status_code == 400
    assert c.put(f"{R}/clients/{first['id']}", json={"name": "ZZCM Another Name"}).status_code == 409
    assert c.put(f"{R}/clients/{first['id']}", json={"default_tds_pct": 10, "is_active": False}).json()["is_active"] is False

    lead = new_lead(c, people["sales_a"], email=f"{TAG}-dup-{uniq()}@example.com", phone="+91 98765-43210")
    as_(c, people["sales_b"])
    by_email = c.post(f"{R}/leads", json={"company_name": "ZZCM Someone", "email": lead["email"].upper()})
    assert by_email.status_code == 409 and by_email.json()["detail"]["duplicates"][0]["matched_on"] == ["email"]
    by_phone = c.post(f"{R}/leads", json={"company_name": "ZZCM Someone", "phone": "09876543210"})
    assert by_phone.status_code == 409 and by_phone.json()["detail"]["duplicates"][0]["matched_on"] == ["phone"]
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM Someone", "phone": "09876543210", "confirm_duplicate": True}).status_code == 200
    assert c.post(f"{R}/leads", json={}).status_code == 400
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x", "email": "nope"}).status_code == 400
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x", "estimated_value": -5}).status_code == 400
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x", "source": "SMOKE_SIGNAL"}).status_code == 400


def test_bulk_import_reports_created_skipped_and_errors(client, people):
    c = client
    existing = new_lead(c, people["sales_a"])
    as_(c, people["sales_a"])
    u = uniq()
    rows = [{"company_name": f"ZZCM Imp A {u}", "email": f"{TAG}-imp-a-{u}@example.com", "estimated_value": 1000},
            {"company_name": f"ZZCM Imp B {u}", "phone": "9000012345"},
            {"company_name": "ZZCM Imp existing", "email": existing["email"]},                         # duplicate of an existing lead
            {"company_name": f"ZZCM Imp A again {u}", "email": f"{TAG}-IMP-A-{u}@example.com"},       # duplicate of an earlier row
            {},                                                                                       # empty
            {"company_name": "ZZCM Imp bad", "email": "broken"}]
    r = c.post(f"{R}/leads/import", json={"rows": rows}).json()
    assert r["summary"] == {"created": 2, "skipped": 2, "errors": 2}
    assert [x["row"] for x in r["created"]] == [1, 2] and [x["row"] for x in r["skipped_duplicates"]] == [3, 4] and [x["row"] for x in r["errors"]] == [5, 6]
    assert r["skipped_duplicates"][0]["duplicates"][0]["code"] == existing["code"]
    forced = c.post(f"{R}/leads/import", json={"rows": [rows[2]], "confirm_duplicate": True}).json()
    assert forced["summary"]["created"] == 1
    assert c.post(f"{R}/leads/import", json={"rows": []}).status_code == 400
    assert c.post(f"{R}/leads/import", json={"rows": [{"company_name": "x"}] * 501}).status_code == 400


def test_lead_stage_moves_follow_ups_and_lost_reasons(client, people):
    c = client
    lead = new_lead(c, people["sales_a"], next_followup_at="2020-01-01")
    as_(c, people["sales_a"])
    assert c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": "CONTACTED", "note": "Called, interested"}).json()["stage"] == "CONTACTED"
    for stage in ("QUALIFIED", "TENDER", "PROPOSAL", "WON"):                                              # these have their own actions with their own rules
        assert c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": stage}).status_code == 400, stage
    assert c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": "CONTACTED"}).status_code == 400
    assert c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": "LOST"}).status_code == 400                # needs a reason
    # the overdue list
    overdue = {x["id"] for x in c.get(f"{R}/leads?overdue=true").json()}
    assert lead["id"] in overdue and c.get(f"{R}/leads/{lead['id']}").json()["followup_overdue"] is True
    future = new_lead(c, people["sales_a"], next_followup_at=(datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"))
    assert future["id"] not in {x["id"] for x in c.get(f"{R}/leads?overdue=true").json()} and future["followup_overdue"] is False
    act = c.post(f"{R}/leads/{lead['id']}/activities", json={"kind": "CALL", "body": "Left a voicemail", "next_followup_at": "2099-01-01"}).json()["activities"]
    assert act[0]["kind"] == "CALL" and act[0]["by_user_name"] == people["sales_a"]["name"] and lead["id"] not in {x["id"] for x in c.get(f"{R}/leads?overdue=true").json()}
    assert c.post(f"{R}/leads/{lead['id']}/activities", json={"kind": "STAGE_CHANGE", "body": "x"}).status_code == 400
    assert c.post(f"{R}/leads/{lead['id']}/activities", json={"kind": "NOTE", "body": " "}).status_code == 400
    lost = c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": "LOST", "lost_reason": "Budget cut", "note": "Client froze spending"}).json()
    assert lost["stage"] == "LOST" and lost["lost_reason"] == "Budget cut" and lost["lost_at"]
    assert c.put(f"{R}/leads/{lead['id']}", json={"contact_name": "x"}).status_code == 400                   # closed leads are frozen
    assert c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": "NEW"}).status_code == 403                # only a manager reopens
    as_(c, people["mgr"])
    assert c.post(f"{R}/leads/{lead['id']}/stage", json={"stage": "NEW", "note": "Budget is back"}).json()["stage"] == "NEW"
    log = c.get(f"{R}/leads/{lead['id']}/activities").json()
    assert [a["body"].split(" — ")[0] for a in reversed([a for a in log if a["kind"] == "STAGE_CHANGE"])] == ["Lead created (NEW)", "NEW → CONTACTED", "CONTACTED → LOST", "LOST → NEW"]


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
    lead_a = qualified_lead(c, people["sales_a"])
    prop_a = new_proposal(c, people["sales_a"], lead_a)
    lead_b = new_lead(c, people["sales_b"])
    _, _, k = active_contract(c, people)
    inv = posted_invoice(c, people, k, "2026-01")

    # --- Sales (edit): works only their own leads and proposals; no review, PO, engagement or accounting
    as_(c, people["sales_a"])
    mine = {x["id"] for x in c.get(f"{R}/leads").json()}
    assert lead_a["id"] in mine and lead_b["id"] not in mine
    assert c.get(f"{R}/leads/{lead_b['id']}").status_code == 404 and c.put(f"{R}/leads/{lead_b['id']}", json={"contact_name": "x"}).status_code == 404
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
    assert c.post(f"{R}/leads", json={"company_name": "ZZCM x"}).status_code == 403 and c.put(f"{R}/leads/{lead_a['id']}", json={"contact_name": "x"}).status_code == 403
    assert c.post(f"{R}/clients", json={"name": "ZZCM viewer client"}).status_code == 403 and c.post(f"{R}/leads/{lead_a['id']}/stage", json={"stage": "CONTACTED"}).status_code == 403
    assert c.get(f"{R}/kpis").status_code == 200 and c.get(f"{R}/pipeline").status_code == 200
    # --- Manager (delete): everything on the sales side, anyone's work
    as_(c, people["mgr"])
    assert c.get(f"{R}/leads/{lead_b['id']}").status_code == 200 and c.put(f"{R}/leads/{lead_b['id']}", json={"contact_name": "Reassigned"}).status_code == 200
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
    assert c.get(f"{R}/invoices").status_code == 200 and c.get(f"{R}/kpis").status_code == 200
    assert c.post(f"{R}/invoices/{inv['id']}/cancel", json={"reason": "x"}).status_code == 403
    assert c.post(f"{R}/payments", json={"client_id": k["client_id"], "amount": 1, "payment_date": "2026-01-01"}).status_code == 403
    assert c.post(f"{R}/advances", json={"client_id": k["client_id"], "amount": 1, "advance_date": "2026-01-01"}).status_code == 403
    assert c.post(f"{R}/invoices/month-end", json={}).status_code == 403
    # --- nobody else
    for who in ("plain", "plain_mgr"):
        as_(c, people[who])
        for url in ("clients", "leads", "proposals", "contracts", "invoices", "payments", "advances", "ledger", "pipeline", "kpis"):
            assert c.get(f"{R}/{url}").status_code == 403, (who, url)
        assert c.post(f"{R}/leads", json={"company_name": "ZZCM x"}).status_code == 403
    c.cookies.clear()
    assert c.get(f"{R}/leads").status_code == 401 and c.get(f"{R}/kpis").status_code == 401
    # an admin can do all of it
    as_(c, people["admin"])
    assert c.get(f"{R}/invoices").status_code == 200 and c.get(f"{R}/leads").status_code == 200 and c.get(f"{R}/pipeline").status_code == 200


# ---------------------------------------------------------------- KPIs and the pipeline summary

def test_kpis_and_pipeline_for_a_fresh_salesperson_return_null_not_zero(client, people):
    c = client
    fresh = _mk_user(c, f"fresh-{uniq()}", "manager", {"sales": (1, 1, 0)})
    as_(c, fresh)
    k = c.get(f"{R}/kpis").json()
    assert (k["lead_to_proposal_pct"], k["win_rate_pct"], k["avg_days_lead_to_po"], k["receivables_overdue_60"]) == (None, None, None, None)
    assert k["leads"] == {"total": 0, "with_proposal": 0, "won": 0, "lost": 0} and all(v == {"count": 0, "value": 0.0} for v in k["pipeline_value_by_stage"].values())
    pl = c.get(f"{R}/pipeline").json()
    assert pl["overdue_followups"] == 0 and [s["count"] for s in pl["steps"]] == [0] * 7 and [s["step"] for s in pl["steps"]][0] == "Lead Capture"
    as_(c, people["acct_view"])
    assert c.get(f"{R}/kpis").json()["lead_to_proposal_pct"] is None                                      # accounts-only: no sales figures


def test_kpi_formulas_and_pipeline_summary(client, people):
    c = client
    me = _mk_user(c, f"kpi-{uniq()}", "manager", {"sales": (1, 1, 0)})                                  # a Sales user owns the leads, so the figures are exact for this user only
    mgr_ctx = people["mgr"]
    won1 = qualified_lead(c, me, estimated_value=100000)                                                 # → proposal → PO (won)
    won2 = qualified_lead(c, me, estimated_value=200000)
    lost = new_lead(c, me, estimated_value=50000)
    open_q = qualified_lead(c, me, estimated_value=300000)                                               # qualified, no proposal
    open_new = new_lead(c, me, estimated_value=10000, next_followup_at="2020-01-01")                      # overdue follow-up
    for lead in (won1, won2):
        prop = new_proposal(c, me, lead)
        assert send(c, me, prop["id"]).status_code == 200 and approve(c, mgr_ctx, prop["id"]).status_code == 200
        as_(c, mgr_ctx)
        assert c.post(f"{R}/proposals/{prop['id']}/book-po", json=PO).status_code == 200
    as_(c, me)
    assert c.post(f"{R}/leads/{lost['id']}/stage", json={"stage": "LOST", "lost_reason": "Price"}).status_code == 200
    now = datetime.now(timezone.utc)
    db(c, "UPDATE leads SET created_at = %s, won_at = %s WHERE id = %s", ((now - timedelta(days=10)).isoformat(), now.isoformat(), won1["id"]))
    db(c, "UPDATE leads SET created_at = %s, won_at = %s WHERE id = %s", ((now - timedelta(days=20)).isoformat(), now.isoformat(), won2["id"]))
    as_(c, me)
    k = c.get(f"{R}/kpis").json()
    assert k["leads"] == {"total": 5, "with_proposal": 2, "won": 2, "lost": 1}
    assert k["lead_to_proposal_pct"] == 40.0                                                              # 2 of 5 leads got a proposal
    assert k["win_rate_pct"] == round(2 * 100 / 3, 2)                                                     # won / (won + lost)
    assert k["avg_days_lead_to_po"] == 15.0                                                               # (10 + 20) / 2
    st = k["pipeline_value_by_stage"]
    assert st["WON"] == {"count": 2, "value": 300000.0} and st["LOST"] == {"count": 1, "value": 50000.0} and st["QUALIFIED"] == {"count": 1, "value": 300000.0} and st["NEW"] == {"count": 1, "value": 10000.0}
    pl = c.get(f"{R}/pipeline").json()
    assert pl["leads_by_stage"]["WON"]["count"] == 2 and pl["proposals"]["ACCEPTED"] == 2 and pl["contracts"]["DRAFT"] == 2 and pl["overdue_followups"] == 1
    assert {s["step"]: s["count"] for s in pl["steps"]} == {"Lead Capture": 1, "Qualify": 1, "Proposal Sent": 0, "Review": 0, "PO Won": 2, "Convert to Engagement": 2, "Closed": 3}
    assert open_q["id"] and open_new["id"]


def test_receivables_overdue_over_60_days(client, people):
    c = client
    _, _, k = active_contract(c, people, contract_value=100000, start_date="2026-01-01", end_date="2026-01-31")
    as_(c, people["acct"])
    before = c.get(f"{R}/kpis").json()["receivables_overdue_60"]
    old = posted_invoice(c, people, k, "2026-01", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=60000)
    recent = posted_invoice(c, people, k, "2026-02", tax_pct=0, tds_pct=0, retention_pct=0, gross_amount=40000)
    db(c, "UPDATE invoices SET invoice_date = %s WHERE id = %s", ((datetime.now(timezone.utc) - timedelta(days=75)).strftime("%Y-%m-%d"), old["id"]))
    db(c, "UPDATE invoices SET invoice_date = %s WHERE id = %s", ((datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d"), recent["id"]))
    as_(c, people["acct"])
    after = c.get(f"{R}/kpis").json()["receivables_overdue_60"]
    base_amount, base_n = (before["amount"], before["invoices"]) if before else (0.0, 0)
    assert after["amount"] - base_amount == 60000.0 and after["invoices"] - base_n == 1                    # only the 75-day-old invoice counts
    pay = c.post(f"{R}/payments", json={"client_id": k["client_id"], "amount": 25000, "payment_date": "2026-03-01"}).json()
    c.post(f"{R}/payments/{pay['id']}/post", json={"allocations": [{"invoice_id": old["id"], "amount": 25000}]})
    assert c.get(f"{R}/kpis").json()["receivables_overdue_60"]["amount"] - base_amount == 35000.0           # part-paid: only what is still outstanding
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


def test_overdue_follow_up_and_expired_proposal_alerts_for_the_owner(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"])
    as_(c, people["sales_a"])
    c.put(f"{R}/leads/{lead['id']}", json={"next_followup_at": "2020-01-01"})
    prop = new_proposal(c, people["sales_a"], lead, valid_until="2020-02-01")
    alerts = c.get(f"{R}/alerts").json()
    assert any(a["kind"] == "FOLLOWUP" and a["lead_id"] == lead["id"] and a["severity"] == "high" for a in alerts)
    assert any(a["kind"] == "PROPOSAL_EXPIRED" and a["proposal_id"] == prop["id"] for a in alerts)
    as_(c, people["sales_b"])        # another salesperson must not see them
    assert not any(a.get("lead_id") == lead["id"] or a.get("proposal_id") == prop["id"] for a in c.get(f"{R}/alerts").json())


def test_csv_exports_are_scoped_and_safe(client, people):
    c = client
    lead = qualified_lead(c, people["sales_a"], company_name=f"=SUM(1+1) {TAG.upper()} {uniq()}")
    as_(c, people["sales_a"])
    r = c.get(f"{R}/reports/leads.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    body = r.content.decode("utf-8-sig")
    assert body.splitlines()[0].startswith("Code,Company") and f"'{lead['company_name']}" in body        # formula-looking text is defused with a leading apostrophe
    assert c.get(f"{R}/reports/invoices.csv").status_code == 403 and c.get(f"{R}/reports/nope.csv").status_code == 404
    as_(c, people["sales_b"])
    assert lead["company_name"] not in c.get(f"{R}/reports/leads.csv").content.decode("utf-8-sig")        # only their own leads
    as_(c, people["acct"])
    for name in ("invoices", "payments", "receivables", "ledger", "contracts"):
        assert c.get(f"{R}/reports/{name}.csv").status_code == 200, name
    assert c.get(f"{R}/reports/leads.csv").status_code == 403


def test_reminder_digests_send_once_per_person_per_day(client, people):
    from app.services import cm_reminders
    c = client
    sent = []
    cm_reminders._send = lambda to, subject, html: sent.append((to, subject, html))
    lead = qualified_lead(c, people["sales_a"])
    as_(c, people["sales_a"])
    c.put(f"{R}/leads/{lead['id']}", json={"next_followup_at": "2020-01-01"})
    monday = datetime(2030, 1, 7, 9, 30, tzinfo=timezone.utc).astimezone(cm_reminders.APP_TIMEZONE).replace(hour=9, minute=30)
    assert monday.weekday() == 0
    n = c.portal.call(lambda: cm_reminders.send_followup_digests(monday))
    mine = [m for m in sent if m[0] == people["sales_a"]["email"]]
    assert n >= 1 and len(mine) == 1 and "Follow-ups due" in mine[0][1] and "overdue" in mine[0][2]
    c.portal.call(lambda: cm_reminders.send_followup_digests(monday))
    assert len([m for m in sent if m[0] == people["sales_a"]["email"]]) == 1                    # same day: not again
    saturday = monday.replace(day=monday.day + 5)
    assert c.portal.call(lambda: cm_reminders.send_followup_digests(saturday)) == 0           # weekends are quiet
    early = monday.replace(hour=6)
    assert c.portal.call(lambda: cm_reminders.send_followup_digests(early)) == 0              # before the reminder time
    db(c, "DELETE FROM reminder_log WHERE kind IN ('cm_followup', 'cm_receivables') AND date = %s", (monday.strftime("%Y-%m-%d"),))


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


def test_public_web_form_creates_unassigned_website_leads_with_guards(client, people):
    from app.services import cm_webform
    c = client
    cm_webform._hits.clear()
    page = c.get("/api/public/lead-form")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"] and "name=website" in page.text         # no login needed; honeypot present
    u = uniq()
    body = {"name": "Web Visitor", "company": f"ZZCM Web Co {u}", "email": f"{TAG}-web-{u}@example.com", "phone": "", "message": "Need a portal built", "website": ""}
    c.cookies.clear()
    assert c.post("/api/public/lead-form", json=body).status_code == 200
    row = db(c, "SELECT * FROM leads WHERE email_norm = %s", (body["email"],), fetch_one=True)
    assert row and row["source"] == "WEBSITE" and row["stage"] == "NEW" and row["owner_id"] is None and row["code"].startswith("LEAD-")
    act = db(c, "SELECT by_user_name, body FROM lead_activities WHERE lead_id = %s ORDER BY id", (row["id"],), fetch_all=True)
    assert any("Need a portal built" in a["body"] for a in act) and act[0]["by_user_name"] == "Web form"
    # a manager sees it (and can assign it); a salesperson with no leads of their own doesn't
    as_(c, people["mgr"])
    assert any(l["id"] == row["id"] for l in c.get(f"{R}/leads").json())
    as_(c, people["sales_b"])
    assert not any(l["id"] == row["id"] for l in c.get(f"{R}/leads").json())
    # the same person again: a note on the existing lead, not a second lead
    c.cookies.clear()
    assert c.post("/api/public/lead-form", json={**body, "message": "Following up"}).status_code == 200
    assert db(c, "SELECT COUNT(*) AS n FROM leads WHERE email_norm = %s", (body["email"],), fetch_one=True)["n"] == 1
    assert any("Following up" in a["body"] for a in db(c, "SELECT body FROM lead_activities WHERE lead_id = %s", (row["id"],), fetch_all=True))
    # bots (honeypot) look successful but store nothing; bad input is refused
    bot = {**body, "email": f"{TAG}-bot-{u}@example.com", "website": "http://spam"}
    assert c.post("/api/public/lead-form", json=bot).status_code == 200
    assert db(c, "SELECT COUNT(*) AS n FROM leads WHERE email_norm = %s", (bot["email"],), fetch_one=True)["n"] == 0
    assert c.post("/api/public/lead-form", json={**body, "name": ""}).status_code == 400
    assert c.post("/api/public/lead-form", json={**body, "email": "", "phone": ""}).status_code == 400
    assert c.post("/api/public/lead-form", json={**body, "email": "not-an-email"}).status_code == 400
    # rate limit per address
    cm_webform._hits.clear()
    codes = [c.post("/api/public/lead-form", json={**body, "name": ""}).status_code for _ in range(cm_webform.RATE_LIMIT + 1)]
    assert codes[-1] == 429
    cm_webform._hits.clear()


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
    assert any("Emailed to c@example.com" in a["body"] for a in c.get(f"{R}/leads/{lead['id']}/activities").json())
    as_(c, people["sales_a"])
    assert c.post(f"{R}/contracts/{k['id']}/send-documents", json={"to": "c@example.com", "documents": ["scope"]}).status_code == 403
