import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SheetGrid } from "./SheetGrid";
import { useSheet } from "./useSheet";
import { ConvertDialog } from "../ConvertDialog";
import { AccountDialog } from "../AccountDialog";
import { useList, canEditRow } from "../data";
import { ACCOUNT_TYPES, INDUSTRIES, LEAD_SOURCES, LEAD_STATUSES, OPP_STAGES, TONES, apiError, day, errorDetail, todayStr } from "../constants";

const personOptions = (people) => people.map(p => ({ value: String(p.id), label: p.name }));
const dateOf = (iso) => (iso ? String(iso).slice(0, 10) : "");

// ============================================================== Leads
export function LeadsSheet({ api, user, level, people, bdr, refreshKey, search, onChanged, openOpp }) {
  const { rows, loading, run, load } = useSheet(api, "/client-mgmt/leads", bdr, refreshKey);
  const [convert, setConvert] = useState(null);
  const mgr = level === "mgr";
  const mine = (r) => canEditRow(level, user, r.owner_id) && !r.converted;
  const save = async (r, key, val) => {
    const body = key === "bdr" ? { owner_id: val ? Number(val) : null } : { [key]: val === "" ? null : val };
    const ok = await run(() => api.put(`/client-mgmt/leads/${r.id}`, body));
    if (ok && key === "status" && val === "Qualified") toast.success(`${r.company_name || r.code} is qualified`, { action: { label: "Convert now", onClick: () => setConvert({ ...r, status: "Qualified" }) } });
    if (ok) onChanged();
  };
  const create = async (v) => {
    const post = (confirm) => api.post("/client-mgmt/leads", { ...v, confirm_duplicate: confirm });
    try { await post(false); toast.success("Lead added"); await load(); onChanged(); return true; }
    catch (e) {
      const d = errorDetail(e);
      if (d?.duplicates && window.confirm(`${d.message}:\n${d.duplicates.map(x => `${x.code} ${x.name || ""}`).join("\n")}\n\nAdd it anyway?`)) { try { await post(true); toast.success("Lead added"); await load(); onChanged(); return true; } catch (e2) { toast.error(apiError(e2, "Couldn't add the lead")); } }
      else if (!d?.duplicates) toast.error(apiError(e, "Couldn't add the lead"));
      return false;
    }
  };
  const columns = useMemo(() => [
    { key: "code", label: "Lead ID", width: 84, type: "readonly" },
    { key: "company_name", label: "Company Name", width: 210 },
    { key: "contact_person", label: "Contact Person", width: 140 },
    { key: "phone", label: "Phone", width: 120 },
    { key: "email", label: "Email", width: 190 },
    { key: "location", label: "Location", width: 130 },
    { key: "source", label: "Lead Source", width: 160, type: "select", options: LEAD_SOURCES, filter: "select", allowEmpty: false },
    { key: "status", label: "Lead Status", width: 120, type: "select", options: LEAD_STATUSES.filter(s => s !== "Converted"), filter: "select", allowEmpty: false, tone: v => TONES.lead[v], editable: r => !r.converted },
    { key: "date_added", label: "Date Added", width: 120, type: "date" },
    mgr ? { key: "bdr", label: "BDR Name", width: 120, type: "select", options: personOptions(people), value: r => (r.owner_id == null ? "" : String(r.owner_id)), emptyLabel: "Unassigned", filter: "select", sortValue: r => r.bdr || "" }
        : { key: "bdr", label: "BDR Name", width: 120, type: "readonly" },
    { key: "converted", label: "Converted?", width: 90, type: "readonly", value: r => (r.converted ? "Yes" : "No"), filter: "select", options: ["Yes", "No"] },
    { key: "interested_in", label: "Interested In / Notes", width: 280 },
    { key: "next_action", label: "Next Action", width: 210 },
    { key: "act", label: "", width: 110, type: "custom", filter: false, sortable: false,
      render: (r) => (r.converted ? <button className="xl-link" onClick={() => openOpp(r.converted_opp_id)} data-testid={`lead-opp-${r.id}`}>Opportunity ↗</button>
        : mine(r) ? <button className="xl-link" style={{ color: "#059669" }} onClick={() => setConvert(r)} data-testid={`convert-${r.id}`}>Convert →</button> : null) },
  ], [mgr, people, openOpp]);   // eslint-disable-line react-hooks/exhaustive-deps
  const canAdd = level === "mgr" || level === "sales";
  return (
    <>
      <SheetGrid columns={columns} rows={rows} loading={loading} search={search} canEditRow={mine} onCellSave={save} freeze={2} empty="No leads yet — type in the green row below, or import your workbook."
        canDeleteRow={r => mgr && !r.converted} onDelete={r => window.confirm(`Delete lead ${r.code}?`) && run(() => api.delete(`/client-mgmt/leads/${r.id}`), "Lead deleted")}
        newRow={{ canAdd, fields: ["company_name", "contact_person", "phone", "email", "location", "source", "interested_in", "next_action"], defaults: { source: "Cold Call", status: "New" }, required: ["company_name"], onCreate: create, placeholder: "Type a company name and press Enter to add a lead…" }} />
      {convert && <ConvertDialog api={api} lead={convert} onClose={() => setConvert(null)} onDone={(d) => { setConvert(null); load(); onChanged(); openOpp(d.opportunity.id); }} />}
    </>
  );
}

// ============================================================== Accounts
export function AccountsSheet({ api, user, level, people, bdr, refreshKey, search, onChanged, openOpp }) {
  const { rows, loading, run, load } = useSheet(api, "/client-mgmt/clients", bdr, refreshKey);
  const [open, setOpen] = useState(null);
  const canEdit = level === "mgr" || level === "sales";
  const save = async (r, key, val) => {
    const body = key === "owner" ? { owner_id: val ? Number(val) : null } : key === "contact_person" ? { contact_person: val } : { [key]: val === "" ? null : val };
    if (await run(() => api.put(`/client-mgmt/clients/${r.id}`, body))) onChanged();
  };
  const create = async (v) => {
    try { await api.post("/client-mgmt/clients", { name: v.name, industry: v.industry || null, location: v.location, website: v.website, contact_person: v.contact_person, phone: v.phone, email: v.email, account_type: v.account_type || "Prospect", notes: v.notes }); toast.success("Account added"); await load(); onChanged(); return true; }
    catch (e) { toast.error(apiError(e, "Couldn't add the account")); return false; }
  };
  const columns = useMemo(() => [
    { key: "code", label: "Account ID", width: 92, type: "readonly" },
    { key: "name", label: "Company Name", width: 230 },
    { key: "industry", label: "Industry", width: 140, type: "select", options: INDUSTRIES, filter: "select", emptyLabel: "" },
    { key: "location", label: "Location", width: 130 },
    { key: "website", label: "Website", width: 170 },
    { key: "contact_person", label: "Primary Contact", width: 140 },
    { key: "phone", label: "Phone", width: 120 },
    { key: "email", label: "Email", width: 190 },
    { key: "account_type", label: "Account Type", width: 130, type: "select", options: ACCOUNT_TYPES, allowEmpty: false, filter: "select", tone: v => TONES.account[v] },
    { key: "owner", label: "Account Owner", width: 130, type: "select", options: personOptions(people), value: r => (r.owner_id == null ? "" : String(r.owner_id)), emptyLabel: "—", filter: "select", sortValue: r => r.owner_name || "" },
    { key: "created", label: "Created Date", width: 110, type: "readonly", value: r => dateOf(r.created_at) },
    { key: "notes", label: "Notes", width: 280 },
  ], [people]);
  return (
    <>
      <SheetGrid columns={columns} rows={rows} loading={loading} search={search} canEditRow={() => canEdit} onCellSave={save} freeze={2} onOpenRow={setOpen} openLabel="Open account (billing, history)"
        canDeleteRow={() => level === "mgr"} onDelete={r => window.confirm(`Delete account ${r.name}?`) && run(() => api.delete(`/client-mgmt/clients/${r.id}`), "Account deleted")}
        newRow={{ canAdd: canEdit, fields: ["name", "industry", "location", "website", "contact_person", "phone", "email", "account_type", "notes"], defaults: { account_type: "Prospect" }, required: ["name"], onCreate: create, placeholder: "Type a company name and press Enter to add an account…" }} />
      {open && <AccountDialog api={api} account={open} people={people} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); onChanged(); }} onOpenOpportunity={(id) => { setOpen(null); openOpp(id); }} />}
    </>
  );
}

// ============================================================== Opportunities
export function OpportunitiesSheet({ api, user, level, people, bdr, refreshKey, search, onChanged, openOpp }) {
  const { rows, loading, run, load } = useSheet(api, "/client-mgmt/opportunities", bdr, refreshKey);
  const [accounts] = useList(api, "/client-mgmt/clients", undefined);
  const mgr = level === "mgr";
  const closed = (r) => ["Closed Won", "Closed Lost"].includes(r.stage);
  const mine = (r) => canEditRow(level, user, r.owner_id);
  const save = async (r, key, val) => {
    const body = key === "bdr" ? { owner_id: val ? Number(val) : null } : key === "deal_value" ? { deal_value: val === "" ? null : Number(val) } : { [key]: val === "" ? null : val };
    const ok = await run(() => api.put(`/client-mgmt/opportunities/${r.id}`, body));
    if (ok) { onChanged(); if (key === "stage" && val === "Closed Won") toast.success(`${r.opp_name} is won 🎉`, mgr ? { action: { label: "Book the PO", onClick: () => openOpp(r.id) } } : undefined); }
  };
  const create = async (v) => {
    try { const { data } = await api.post("/client-mgmt/opportunities", { company_name: v.account_name, opp_name: v.opp_name || undefined, contact_person: v.contact_person || undefined, deal_value: v.deal_value === "" || v.deal_value == null ? undefined : Number(v.deal_value), expected_close_date: v.expected_close_date || undefined, next_action: v.next_action || undefined });
      toast.success(`Opportunity ${data.code} created`); await load(); onChanged(); return true; }
    catch (e) { toast.error(apiError(e, "Couldn't add the opportunity")); return false; }
  };
  const columns = useMemo(() => [
    { key: "code", label: "Opportunity ID", shortLabel: "Opp ID", width: 84, type: "readonly" },
    { key: "account_name", label: "Company Name", width: 200, type: "readonly", datalist: "cm-account-names" },
    { key: "opp_name", label: "Opp Name", width: 250 },
    { key: "contact_person", label: "Contact Person", width: 130 },
    { key: "stage", label: "Stage", width: 190, type: "select", options: OPP_STAGES, allowEmpty: false, filter: "select", tone: v => TONES.stage[v], editable: r => !closed(r) || mgr },
    { key: "deal_value", label: "Deal Value (INR)", shortLabel: "Deal Value (INR)", width: 130, type: "money", align: "right", sum: true, sumLabel: "Deal value" },
    { key: "probability", label: "Probability %", width: 100, type: "readonly", align: "right", display: v => `${v}%` },
    { key: "weighted_value", label: "Weighted Value (INR)", width: 140, type: "readonly", align: "right", sum: true, sumLabel: "Weighted" },
    { key: "expected_close_date", label: "Expected Close Date", width: 135, type: "date" },
    { key: "lead_source", label: "Lead Source", width: 150, type: "select", options: LEAD_SOURCES, filter: "select" },
    mgr ? { key: "bdr", label: "BDR Name", width: 120, type: "select", options: personOptions(people), value: r => (r.owner_id == null ? "" : String(r.owner_id)), emptyLabel: "Unassigned", filter: "select", sortValue: r => r.bdr || "" } : { key: "bdr", label: "BDR Name", width: 120, type: "readonly" },
    { key: "created_date", label: "Created Date", width: 110, type: "readonly" },
    { key: "last_activity_date", label: "Last Activity Date", width: 125, type: "readonly" },
    { key: "next_action", label: "Next Action", width: 230 },
    { key: "notes", label: "Notes", width: 280 },
  ], [mgr, people]);   // eslint-disable-line react-hooks/exhaustive-deps
  const canAdd = level === "mgr" || level === "sales";
  return (
    <>
      <datalist id="cm-account-names">{(accounts || []).map(a => <option key={a.id} value={a.name} />)}</datalist>
      <SheetGrid columns={columns} rows={rows} loading={loading} search={search} canEditRow={mine} onCellSave={save} freeze={3} onOpenRow={(r) => openOpp(r.id)} openLabel="Open opportunity (proposals, follow-ups, contract)"
        empty="No opportunities yet — convert a qualified lead, or type in the green row below."
        newRow={{ canAdd, fields: ["account_name", "opp_name", "contact_person", "deal_value", "expected_close_date", "next_action"], required: ["account_name"], onCreate: create, placeholder: "Company name — press Enter to add an opportunity…" }} />
    </>
  );
}
