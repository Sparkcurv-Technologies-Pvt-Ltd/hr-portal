"""Public (no-login) proposal reply: ``/api/public/proposals/{token}``.

The unguessable token in the link is the only credential. It opens exactly one proposal and exposes only the client-facing content
(items, rates, total, terms) — never costs, margins, owners or other proposals. An unknown, expired or withdrawn token is a plain 404.
"""

import html

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.schemas.client_mgmt import PublicReply
from app.services import cm_sales as sales


public_proposals_router = APIRouter(prefix="/public/proposals")


@public_proposals_router.get("/{token}")
async def view_proposal(token: str):
    return await sales.public_view(token)


@public_proposals_router.post("/{token}/reply")
async def reply_to_proposal(token: str, data: PublicReply):
    """Body: ``{"action": "accept" | "changes", "message": "...", "name": "..."}``."""
    return await sales.public_reply(token, data)


@public_proposals_router.get("/{token}/page", response_class=HTMLResponse)
async def proposal_page(token: str, request: Request):
    """A small self-contained page (the link in the email) to read the proposal and accept it or ask for changes, without any login."""
    p = await sales.public_view(token)
    e = html.escape
    rows = "".join(f"<tr><td>{i['line_no']}</td><td>{e(i['description'])}</td><td class=r>{i['quantity']:g} {e(i['unit'] or '')}</td><td class=r>{i['rate']:,.2f}</td><td class=r>{i['amount']:,.2f}</td></tr>" for i in p["items"])
    done = f"<p class=note>You replied: <b>{e(p['your_reply'])}</b>. We'll be in touch.</p>" if p["your_reply"] and not p["can_reply"] else ""
    form = ("""<form id=f><label>Your name<input name=name></label><label>Message (required if you want changes)<textarea name=message rows=3></textarea></label>
      <div class=btns><button type=button onclick="send('accept')" class=ok>Accept proposal</button><button type=button onclick="send('changes')" class=ch>Ask for changes</button></div><p id=msg class=note></p></form>
      <script>async function send(a){const f=document.getElementById('f');const r=await fetch('reply',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:a,name:f.name.value,message:f.message.value})});const j=await r.json();document.getElementById('msg').textContent=j.message||j.detail||'Something went wrong';
      if(r.ok){f.querySelectorAll('button').forEach(b=>b.disabled=true)}}</script>""" if p["can_reply"] else done)
    page = f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>{e(p['title'])}</title>
<style>body{{font-family:Arial,sans-serif;background:#eef2fb;margin:0;padding:24px;color:#0f172a}}.c{{max-width:760px;margin:0 auto;background:#fff;border-radius:14px;padding:28px}}
h1{{color:#0020f8;margin:0 0 4px}}table{{width:100%;border-collapse:collapse;margin:18px 0}}th,td{{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px}}.r{{text-align:right}}
.tot{{text-align:right;font-weight:700;font-size:16px}}label{{display:block;margin:12px 0;font-size:13px}}input,textarea{{display:block;width:100%;box-sizing:border-box;padding:8px;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px}}
button{{padding:10px 18px;border:0;border-radius:10px;color:#fff;font-weight:700;cursor:pointer}}.ok{{background:#059669}}.ch{{background:#d97706}}.btns{{display:flex;gap:10px}}.note{{color:#475569;font-size:14px}}</style></head>
<body><div class=c><h1>{e(p['title'])}</h1><p class=note>{e(p['code'])} · prepared for {e(p['client_name'])}{' · valid until ' + e(p['valid_until']) if p['valid_until'] else ''}</p>
<table><tr><th>#</th><th>Description</th><th class=r>Qty</th><th class=r>Rate</th><th class=r>Amount</th></tr>{rows}</table><p class=tot>Total {p['total_amount']:,.2f}</p>
{('<h3>Terms</h3><p class=note>' + e(p['terms']).replace(chr(10), '<br>') + '</p>') if p['terms'] else ''}{form}</div></body></html>"""
    return HTMLResponse(page)
