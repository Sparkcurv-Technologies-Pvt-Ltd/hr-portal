import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useList } from "./data";
import { ACCOUNT_TYPES, INDUSTRIES, TONES, Pill, apiError, day, errorDetail, moneyShort, selectClass } from "./constants";

const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";
const BLANK = { name: "", industry: "", location: "", website: "", contact_person: "", phone: "", email: "", account_type: "Prospect", owner_id: "", notes: "", gstin: "", billing_address: "", default_tds_pct: 0, default_retention_pct: 0, is_active: true };

// One account (company): the sheet's columns, plus the billing details invoicing needs, and what is going on with it (opportunities, follow-ups, recent activity)
export function AccountDialog({ api, account, people, canEdit, onClose, onSaved, onOpenOpportunity }) {
  const [f, setF] = useState(account ? { ...BLANK, ...Object.fromEntries(Object.entries(account).map(([k, v]) => [k, v ?? ""])), owner_id: account.owner_id ?? "" } : BLANK);
  const [dup, setDup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [opps] = useList(api, "/client-mgmt/opportunities", useMemo(() => (account ? { client_id: account.id } : { client_id: -1 }), [account]));
  const [fus] = useList(api, "/client-mgmt/followups", useMemo(() => (account ? { client_id: account.id } : { client_id: -1 }), [account]));
  const [acts] = useList(api, "/client-mgmt/activity", useMemo(() => (account ? { client_id: account.id, limit: 8 } : { client_id: -1 }), [account]));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (confirm = false) => {
    setBusy(true);
    const body = { name: f.name, industry: f.industry || null, location: f.location, website: f.website, contact_person: f.contact_person, phone: f.phone, email: f.email, account_type: f.account_type, notes: f.notes,
                   gstin: f.gstin || null, billing_address: f.billing_address, default_tds_pct: Number(f.default_tds_pct) || 0, default_retention_pct: Number(f.default_retention_pct) || 0, is_active: !!f.is_active,
                   owner_id: f.owner_id ? Number(f.owner_id) : null };
    try { account ? await api.put(`/client-mgmt/clients/${account.id}`, body) : await api.post("/client-mgmt/clients", { ...body, confirm_duplicate: confirm }); toast.success("Account saved"); onSaved(); }
    catch (e) { const d = errorDetail(e); if (d?.duplicates) setDup(d); else toast.error(apiError(e, "Couldn't save the account")); }
    finally { setBusy(false); }
  };
  const input = (k, label, props = {}) => <div><Label className="text-xs">{label}</Label><Input value={f[k] ?? ""} onChange={set(k)} disabled={!canEdit} data-testid={`ac-${k}`} {...props} /></div>;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto" data-testid="account-dialog">
        <DialogHeader><DialogTitle>{account ? `${account.code} · ${account.name}` : "New account"}</DialogTitle></DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">{input("name", "Company name")}</div>
          <div><Label className="text-xs">Industry</Label><select className={selectClass} value={f.industry} onChange={set("industry")} disabled={!canEdit}><option value="">—</option>{INDUSTRIES.map(i => <option key={i}>{i}</option>)}</select></div>
          {input("location", "Location")}{input("website", "Website")}{input("contact_person", "Primary contact")}{input("phone", "Phone")}{input("email", "Email")}
          <div><Label className="text-xs">Account type</Label><select className={selectClass} value={f.account_type} onChange={set("account_type")} disabled={!canEdit} data-testid="ac-type">{ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><Label className="text-xs">Account owner</Label><select className={selectClass} value={f.owner_id} onChange={set("owner_id")} disabled={!canEdit}><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="sm:col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={2} value={f.notes} onChange={set("notes")} disabled={!canEdit} data-testid="ac-notes" /></div>
        </div>
        <details className="rounded-xl p-3" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>
          <summary className="text-sm font-semibold cursor-pointer">Billing details (needed once you invoice)</summary>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">{input("gstin", "GSTIN")}{input("billing_address", "Billing address")}{input("default_tds_pct", "Default TDS %", { type: "number" })}{input("default_retention_pct", "Default retention %", { type: "number" })}
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.is_active} disabled={!canEdit} onChange={e => setF({ ...f, is_active: e.target.checked })} /> Active</label></div>
        </details>
        {dup && <div className="rounded-xl p-3 text-sm" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }} data-testid="client-duplicate"><p className="font-semibold">{dup.message}</p>{dup.duplicates.map(d => <p key={d.id} className="text-xs">{d.code} · {d.name}</p>)}
          {dup.can_confirm && <Button size="sm" variant="outline" className="rounded-lg h-8 mt-2" onClick={() => save(true)} data-testid="client-create-anyway">Create it anyway</Button>}</div>}
        {canEdit && <Button onClick={() => save(false)} disabled={busy || !f.name.trim()} className={primary} data-testid="ac-save">{busy ? "Saving…" : "Save account"}</Button>}
        {account && (
          <div className="space-y-4">
            <section><h4 className="font-bold font-['Outfit'] mb-1.5">Opportunities</h4>{(opps || []).length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>None.</p>}
              {(opps || []).map(o => <button key={o.id} className="flex flex-wrap items-center gap-2 text-sm py-1 text-left hover:underline w-full" onClick={() => onOpenOpportunity(o.id)}><span className="font-semibold">{o.code}</span><span>{o.opp_name}</span><Pill tone={TONES.stage[o.stage]}>{o.stage}</Pill><span className="text-xs">{moneyShort(o.deal_value)}</span></button>)}</section>
            <section><h4 className="font-bold font-['Outfit'] mb-1.5">Follow-ups</h4>{(fus || []).length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>None.</p>}
              {(fus || []).map(x => <p key={x.id} className="text-sm">{x.code} · {x.bdr || "—"} · {x.current_step}</p>)}</section>
            <section><h4 className="font-bold font-['Outfit'] mb-1.5">Recent activity</h4>{(acts || []).length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>None.</p>}
              {(acts || []).map(a => <p key={a.id} className="text-sm"><span className="chip tone-blue mr-2">{a.activity_type.toLowerCase()}</span>{day(a.log_date)} · {a.bdr} {a.outcome ? `· ${a.outcome}` : ""}{a.notes ? ` — ${a.notes}` : ""}</p>)}</section>
          </div>)}
      </DialogContent>
    </Dialog>
  );
}

