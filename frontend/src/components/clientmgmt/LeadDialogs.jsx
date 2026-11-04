import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Warning, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SOURCES, selectClass, apiError, errorDetail, money } from "./constants";

const primary = "w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";

// New lead: a matching email or phone shows the existing lead and asks whether to create it anyway
export function NewLeadDialog({ open, onOpenChange, api, people, canAssign, onCreated }) {
  const EMPTY = { company_name: "", contact_name: "", phone: "", email: "", estimated_value: "", source: "REFERRAL", owner_id: "", next_followup_at: "" };
  const [form, setForm] = useState(EMPTY);
  const [dups, setDups] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(EMPTY); setDups(null); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); if (k === "email" || k === "phone") setDups(null); };
  const submit = async (confirm = false) => {
    setBusy(true);
    try {
      const body = { ...form, estimated_value: form.estimated_value === "" ? null : Number(form.estimated_value), owner_id: form.owner_id ? Number(form.owner_id) : null, next_followup_at: form.next_followup_at || null, confirm_duplicate: confirm };
      const { data } = await api.post("/client-mgmt/leads", body);
      toast.success(`Lead ${data.code} added`); onOpenChange(false); onCreated(data);
    } catch (e) { const d = errorDetail(e); if (e.response?.status === 409 && d?.duplicates) setDups(d.duplicates); else toast.error(apiError(e, "Couldn't add the lead")); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Company</Label><Input value={form.company_name} onChange={e => set("company_name", e.target.value)} data-testid="nl-company" /></div>
            <div><Label>Contact name</Label><Input value={form.contact_name} onChange={e => set("contact_name", e.target.value)} data-testid="nl-contact" /></div>
            <div><Label>Estimated value</Label><Input type="number" min="0" value={form.estimated_value} onChange={e => set("estimated_value", e.target.value)} data-testid="nl-value" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} data-testid="nl-phone" /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e => set("email", e.target.value)} data-testid="nl-email" /></div>
            <div><Label>Source</Label><select className={selectClass} value={form.source} onChange={e => set("source", e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><Label>Next follow-up</Label><Input type="date" value={form.next_followup_at} onChange={e => set("next_followup_at", e.target.value)} /></div>
            {canAssign && <div className="col-span-2"><Label>Owner</Label><select className={selectClass} value={form.owner_id} onChange={e => set("owner_id", e.target.value)}><option value="">Me</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
          </div>
          {dups && (
            <div className="rounded-xl p-3 text-sm" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }} data-testid="lead-duplicate-warning">
              <p className="font-semibold flex items-center gap-1.5" style={{ color: "#B45309" }}><Warning className="h-4 w-4" weight="fill" /> A lead with the same {dups[0].matched_on.join(" / ")} already exists</p>
              {dups.map(d => <p key={d.id} className="text-xs mt-1">{d.code} · <strong>{d.name}</strong> ({d.stage.toLowerCase()}{d.owner_name ? `, ${d.owner_name}` : ""})</p>)}
              <div className="flex gap-2 mt-3"><Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setDups(null)}>Change details</Button><Button size="sm" className="rounded-lg h-8 bg-[#D97706] text-white hover:bg-[#B45309]" onClick={() => submit(true)} data-testid="create-anyway">Create it anyway</Button></div>
            </div>)}
          {!dups && <Button onClick={() => submit(false)} disabled={busy} className={primary} data-testid="nl-submit">{busy ? "Saving…" : "Add lead"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Bulk import: paste CSV rows or choose a CSV file (columns: company, contact, phone, email, value, source). Rows that look like duplicates are skipped and reported.
const HEADERS = { company: "company_name", company_name: "company_name", contact: "contact_name", contact_name: "contact_name", phone: "phone", email: "email", value: "estimated_value", estimated_value: "estimated_value", source: "source" };
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const split = (l) => l.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
  const cols = split(lines[0]).map(h => HEADERS[h.toLowerCase().replace(/\s+/g, "_")] || null);
  return lines.slice(1).map(line => { const cells = split(line); const row = {}; cols.forEach((k, i) => { if (k && cells[i]) row[k] = k === "estimated_value" ? Number(cells[i].replace(/,/g, "")) || null : k === "source" ? cells[i].toUpperCase().replace(/ /g, "_") : cells[i]; }); return row; });
}
export function ImportLeadsDialog({ open, onOpenChange, api, onDone }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(""); setResult(null); } }, [open]);
  const rows = parseCsv(text);
  const run = async (confirm = false) => {
    setBusy(true);
    try { const { data } = await api.post("/client-mgmt/leads/import", { rows, confirm_duplicate: confirm }); setResult(data); if (data.summary.created) onDone(); }
    catch (e) { toast.error(apiError(e, "Import failed")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>Import leads</DialogTitle></DialogHeader>
        {!result ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>First line = column names: <code>company, contact, phone, email, value, source</code>.</p>
            <input type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(setText); }} data-testid="import-file" />
            <Textarea rows={8} className="font-mono text-xs" placeholder={"company,contact,phone,email,value,source\nAcme Ltd,Asha,9000000001,asha@acme.com,250000,REFERRAL"} value={text} onChange={e => setText(e.target.value)} data-testid="import-text" />
            <p className="text-xs">{rows.length} row{rows.length === 1 ? "" : "s"} ready</p>
            <Button onClick={() => run(false)} disabled={busy || rows.length === 0} className={primary} data-testid="import-run"><UploadSimple className="h-4 w-4 mr-1.5" /> {busy ? "Importing…" : "Import"}</Button>
          </div>
        ) : (
          <div className="space-y-3" data-testid="import-result">
            <p className="text-sm"><strong>{result.summary.created}</strong> created · <strong>{result.summary.skipped}</strong> skipped as duplicates · <strong>{result.summary.errors}</strong> with errors</p>
            {result.skipped_duplicates.map(s => <p key={s.row} className="text-xs rounded-lg p-2" style={{ background: "#FFFBEB" }}>Row {s.row}: duplicate of {s.duplicates.map(d => d.code || d.matched_on.join(", ")).join(", ")}</p>)}
            {result.errors.map(s => <p key={s.row} className="text-xs rounded-lg p-2" style={{ background: "#FEF2F2" }}>Row {s.row}: {s.error}</p>)}
            <div className="flex gap-2">{result.skipped_duplicates.length > 0 && <Button variant="outline" className="rounded-xl h-9" onClick={() => run(true)} disabled={busy}>Import the duplicates too</Button>}<Button className="rounded-xl h-9" onClick={() => onOpenChange(false)}>Done</Button></div>
          </div>)}
      </DialogContent>
    </Dialog>
  );
}

// Qualify: pick an existing client or create one from the lead; the server lists exactly what is missing
export function QualifyDialog({ open, onOpenChange, api, lead, clients, onDone }) {
  const [clientId, setClientId] = useState("");
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setClientId(lead?.client_id || ""); setNote(""); setMissing(null); } }, [open, lead]);
  const submit = async () => {
    setBusy(true); setMissing(null);
    try { await api.post(`/client-mgmt/leads/${lead.id}/qualify`, clientId ? { client_id: Number(clientId), note } : { create_client: true, note }); toast.success("Lead qualified"); onOpenChange(false); onDone(); }
    catch (e) { const d = errorDetail(e); if (d?.missing) setMissing(d.missing); else toast.error(apiError(e, "Couldn't qualify")); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Qualify {lead?.company_name || lead?.code}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Client</Label><select className={selectClass} value={clientId} onChange={e => setClientId(e.target.value)} data-testid="qualify-client"><option value="">Create a new client from this lead{lead?.company_name ? ` (${lead.company_name})` : ""}</option>{clients.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
          <div><Label>Note (optional)</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
          {missing && <div className="rounded-xl p-3 text-sm" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }} data-testid="qualify-missing"><p className="font-semibold" style={{ color: "#991B1B" }}>This lead can't be qualified yet. Missing:</p><ul className="list-disc ml-5 mt-1 text-xs">{missing.map(m => <li key={m}>{m}</li>)}</ul></div>}
          <Button onClick={submit} disabled={busy} className={primary} data-testid="qualify-submit">{busy ? "Checking…" : "Qualify"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Small one-field dialogs: lost reason, tender, proposal title
export function PromptDialog({ open, onOpenChange, title, fields, submitLabel, onSubmit }) {
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setVals(Object.fromEntries(fields.map(f => [f.key, f.initial || ""]))); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    const missing = fields.find(f => f.required && !String(vals[f.key] || "").trim());
    if (missing) return toast.error(`Enter ${missing.label.toLowerCase()}`);
    setBusy(true);
    try { await onSubmit(vals); onOpenChange(false); } catch (e) { if (!e?.handled) toast.error(apiError(e, "That didn't work")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">{fields.map(f => <div key={f.key}><Label>{f.label}</Label>{f.type === "textarea" ? <Textarea rows={3} value={vals[f.key] || ""} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} data-testid={`prompt-${f.key}`} /> : <Input type={f.type || "text"} value={vals[f.key] || ""} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} data-testid={`prompt-${f.key}`} />}</div>)}
          <Button onClick={go} disabled={busy} className={primary} data-testid="prompt-submit">{busy ? "Saving…" : submitLabel}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
export { money };
