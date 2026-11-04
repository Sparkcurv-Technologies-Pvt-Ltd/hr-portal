"""Public lead-capture form: ``/api/public/lead-form`` (page, GET) and ``/api/public/lead-form`` (submit, POST). No login; see ``cm_webform`` for the guards."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.schemas.client_mgmt import WebFormIn
from app.services import cm_webform

public_lead_form_router = APIRouter(prefix="/public/lead-form")

PAGE = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Contact us</title>
<style>body{font-family:Arial,sans-serif;background:#eef2fb;margin:0;padding:20px;color:#0f172a}.c{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px}
h1{color:#0020f8;margin:0 0 4px;font-size:22px}p.s{color:#475569;font-size:14px;margin:0 0 14px}label{display:block;margin:12px 0;font-size:13px;font-weight:600}
input,textarea{display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;font-weight:400}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#0020f8;color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin-top:6px}button:disabled{opacity:.6}
.hp{position:absolute;left:-5000px;height:0;overflow:hidden}#msg{margin-top:12px;font-size:14px}.ok{color:#047857}.err{color:#b91c1c}</style></head>
<body><div class=c><h1>Get in touch</h1><p class=s>Tell us a little about what you need and our team will contact you.</p>
<form id=f novalidate><label>Your name *<input name=name maxlength=200 autocomplete=name></label><label>Company<input name=company maxlength=200 autocomplete=organization></label>
<label>Email<input name=email type=email maxlength=255 autocomplete=email></label><label>Phone<input name=phone maxlength=40 autocomplete=tel></label>
<label>How can we help?<textarea name=message rows=4 maxlength=2000></textarea></label>
<div class=hp aria-hidden=true><label>Website<input name=website tabindex=-1 autocomplete=off></label></div>
<button id=b type=submit>Send</button><p id=msg role=status></p></form></div>
<script>document.getElementById('f').addEventListener('submit',async function(ev){ev.preventDefault();var f=ev.target,m=document.getElementById('msg'),b=document.getElementById('b');
var body={};['name','company','email','phone','message','website'].forEach(function(k){body[k]=f[k].value});b.disabled=true;m.className='';m.textContent='';
try{var r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var j=await r.json();
if(r.ok){m.className='ok';m.textContent=j.message;f.reset();}else{m.className='err';m.textContent=(typeof j.detail==='string'?j.detail:'Please check the form and try again.');b.disabled=false;}}
catch(e){m.className='err';m.textContent='Could not send. Please try again.';b.disabled=false;}});</script></body></html>"""


@public_lead_form_router.get("", response_class=HTMLResponse)
async def lead_form_page():
    return HTMLResponse(PAGE, headers={"X-Content-Type-Options": "nosniff"})


@public_lead_form_router.post("")
async def submit_lead_form(data: WebFormIn, request: Request):
    who = (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown"))
    return await cm_webform.submit(data, who)
