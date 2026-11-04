import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, UploadSimple, Warning, Link as LinkIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { WebFormDialog } from "@/components/clientmgmt/WebFormDialog";
import { StepBar } from "@/components/clientmgmt/StepBar";
import { LeadsBoard } from "@/components/clientmgmt/LeadsBoard";
import { LeadDetail } from "@/components/clientmgmt/LeadDetail";
import { NewLeadDialog, ImportLeadsDialog, QualifyDialog, PromptDialog } from "@/components/clientmgmt/LeadDialogs";
import { ProposalsPanel, ContractsPanel, ClientsPanel } from "@/components/clientmgmt/SalesPanels";
import { DashboardPanel } from "@/components/clientmgmt/DashboardPanel";
import { InvoicesPanel, PaymentsPanel, AdvancesPanel, LedgerPanel } from "@/components/clientmgmt/AccountsPanels";
import { STAGE, apiError, money } from "@/components/clientmgmt/constants";

const VIEWS = [["dashboard", "Dashboard"], ["flow", "Sales Flow"], ["clients", "Clients"], ["proposals", "Proposals"], ["contracts", "Contracts"], ["invoices", "Invoices"], ["payments", "Payments"], ["advances", "Advances"], ["ledger", "Ledger"]];
const STEP_VIEW = { "Lead Capture": "flow", "Qualify": "flow", "Proposal Sent": "proposals", "Review": "proposals", "PO Won": "proposals", "Convert to Engagement": "contracts", "Closed": "flow" };

// Client Management: Lead → Qualify → (Tender) → Proposal → Review → PO won → Contract → Engagement → Invoice → Payment → Ledger
export function ClientMgmtTab({ api, user }) {
  const flags = user.client_mgmt || {};
  const level = flags.sales || null;          // 'mgr' | 'sales' | 'viewer'
  const acct = flags.accounts || null;        // 'acct' | 'viewer'
  const views = VIEWS.filter(([k]) => k === "dashboard" ? true : ["flow", "proposals", "contracts"].includes(k) ? !!level || (k === "contracts" && !!acct) : k === "clients" ? true : !!acct);
  const [view, setView] = useState(views[0]?.[0] || "flow");
  const [step, setStep] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [leads, setLeads] = useState([]);
  const [clients, setClients] = useState([]);
  const [people, setPeople] = useState([]);
  const [openLead, setOpenLead] = useState(null);
  const [newLead, setNewLead] = useState(false);
  const [importing, setImporting] = useState(false);
  const [webForm, setWebForm] = useState(false);
  const [openContract, setOpenContract] = useState(null);
  const [drop, setDrop] = useState(null);         // { lead, stage }
  const canWriteLeads = level === "mgr" || level === "sales";

  const refresh = useCallback(async () => {
    try {
      const calls = [api.get("/client-mgmt/clients"), api.get("/client-mgmt/people")];
      if (level) calls.push(api.get("/client-mgmt/pipeline"), api.get("/client-mgmt/leads"), api.get("/client-mgmt/kpis"));
      const [c, p, pl, l, k] = await Promise.all(calls);
      setClients(c.data); setPeople(p.data);
      if (pl) { setPipeline(pl.data); setLeads(l.data); setKpis(k.data); }
    } catch (e) { toast.error(apiError(e, "Couldn't load Client Management")); }
  }, [api, level]);
  useEffect(() => { refresh(); }, [refresh]);

  const stageMove = async (lead, stage, extra = {}) => {
    try { await api.post(`/client-mgmt/leads/${lead.id}/stage`, { stage, ...extra }); toast.success(`Moved to ${STAGE[stage].label}`); await refresh(); }
    catch (e) { toast.error(apiError(e, "Couldn't move the lead")); }
  };
  const onDropStage = (lead, stage) => {
    if (stage === lead.stage) return;
    if (["NEW", "CONTACTED"].includes(stage) && ["NEW", "CONTACTED"].includes(lead.stage)) return stageMove(lead, stage);
    if (stage === "WON") { toast.message("A lead is Won by booking the PO on an approved proposal — opening it."); return setOpenLead(lead.id); }
    if (stage === "NEW" && lead.stage === "LOST") return stageMove(lead, "NEW");
    if (["LOST", "QUALIFIED", "TENDER", "PROPOSAL"].includes(stage)) return setDrop({ lead, stage });
    toast.error(`A lead can't go from ${STAGE[lead.stage].label} to ${STAGE[stage].label}`);
  };

  const onAlert = (a) => {
    if (a.lead_id) return setOpenLead(a.lead_id);
    if (a.proposal_id) return pickView("proposals");
    if (a.contract_id) { setOpenContract({ id: a.contract_id, n: Date.now() }); return pickView("contracts"); }
    if (a.invoice_id) return pickView("invoices");
  };
  const pickStep = (name) => { setStep(name); setView(STEP_VIEW[name]); };
  const pickView = (v) => { setStep(null); setView(v); };
  const stats = useMemo(() => {
    const by = pipeline?.leads_by_stage || {};
    const open = ["NEW", "CONTACTED", "QUALIFIED", "TENDER", "PROPOSAL"].reduce((s, k) => s + (by[k]?.value || 0), 0);
    return { open, overdue: pipeline?.overdue_followups ?? 0 };
  }, [pipeline]);
  const pct = (v) => (v == null ? "—" : `${v}%`);
  const shownLeads = step === "Lead Capture" ? leads.filter(l => ["NEW", "CONTACTED"].includes(l.stage)) : step === "Qualify" ? leads.filter(l => ["QUALIFIED", "TENDER"].includes(l.stage)) : step === "Closed" ? leads.filter(l => ["WON", "LOST"].includes(l.stage)) : leads;

  return (
    <div className="space-y-5" data-testid="client-mgmt-tab">
      <div className="flex flex-wrap gap-2" role="tablist" data-testid="cm-views">{views.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => pickView(k)} data-testid={`cm-view-${k}`} className="rounded-full px-4 h-9 text-sm font-semibold" style={view === k ? { background: "var(--brand-primary)", color: "#fff" } : { background: "var(--surface)", border: "1px solid var(--border-color)" }}>{l}</button>)}</div>

      {level && pipeline && (view === "flow" || ["proposals", "contracts"].includes(view)) && <StepBar steps={pipeline.steps} active={step} onPick={pickStep} />}

      {view === "dashboard" && <DashboardPanel api={api} sales={!!level} accounts={!!acct} onAlert={onAlert} />}
      {view === "flow" && level && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="cm-kpis">
            <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Open pipeline</p><p className="text-xl font-bold" data-testid="kpi-open">{money(stats.open)}</p></div>
            <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Lead → proposal</p><p className="text-xl font-bold" data-testid="kpi-l2p">{pct(kpis?.lead_to_proposal_pct)}</p></div>
            <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Win rate</p><p className="text-xl font-bold" data-testid="kpi-win">{pct(kpis?.win_rate_pct)}</p></div>
            <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Follow-ups due</p><p className="text-xl font-bold flex items-center gap-1" style={{ color: stats.overdue ? "#E11D48" : undefined }} data-testid="kpi-overdue">{stats.overdue > 0 && <Warning className="h-4 w-4" weight="fill" />}{stats.overdue}</p></div>
          </div>
          {kpis?.receivables_overdue_60 && kpis.receivables_overdue_60.invoices > 0 && <p className="text-sm rounded-xl p-3" style={{ background: "#FEF2F2", color: "#991B1B" }} data-testid="kpi-receivables">{money(kpis.receivables_overdue_60.amount)} across {kpis.receivables_overdue_60.invoices} invoice(s) is over 60 days old.</p>}
          <div className="flex flex-wrap gap-2">
            {canWriteLeads && <><Button className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" onClick={() => setNewLead(true)} data-testid="new-lead"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> New lead</Button>
              <Button variant="outline" className="rounded-xl h-10" onClick={() => setImporting(true)} data-testid="import-leads"><UploadSimple className="h-4 w-4 mr-1.5" /> Import CSV</Button></>}
            <Button variant="outline" className="rounded-xl h-10" onClick={() => setWebForm(true)} data-testid="web-form-link"><LinkIcon className="h-4 w-4 mr-1.5" /> Web form link</Button></div>
          <LeadsBoard leads={shownLeads} canMove={canWriteLeads} onOpen={(l) => setOpenLead(l.id)} onDropStage={onDropStage} />
        </>)}
      {view === "clients" && <ClientsPanel api={api} level={level} canEdit={level === "mgr" || acct === "acct"} />}
      {view === "proposals" && level && <ProposalsPanel api={api} user={user} level={level} focus={step} />}
      {view === "contracts" && <ContractsPanel key={openContract?.n || "all"} api={api} level={level} canAccounts={!!acct} focus={step} openId={openContract?.id} />}
      {view === "invoices" && acct && <InvoicesPanel api={api} canEdit={acct === "acct"} />}
      {view === "payments" && acct && <PaymentsPanel api={api} canEdit={acct === "acct"} />}
      {view === "advances" && acct && <AdvancesPanel api={api} canEdit={acct === "acct"} />}
      {view === "ledger" && acct && <LedgerPanel api={api} />}

      <NewLeadDialog open={newLead} onOpenChange={setNewLead} api={api} people={people} canAssign={level === "mgr"} onCreated={refresh} />
      <WebFormDialog api={api} open={webForm} onOpenChange={setWebForm} />
      <ImportLeadsDialog open={importing} onOpenChange={setImporting} api={api} onDone={refresh} />
      {openLead && <LeadDetail api={api} user={user} leadId={openLead} open onOpenChange={(o) => !o && setOpenLead(null)} level={level} clients={clients} people={people} onChanged={refresh} onOpenContract={() => { setOpenLead(null); pickView("contracts"); }} />}

      {drop && drop.stage === "LOST" && <PromptDialog open onOpenChange={(o) => !o && setDrop(null)} title="Mark the lead lost" submitLabel="Mark lost" fields={[{ key: "reason", label: "Reason", required: true }]}
        onSubmit={async (v) => { await api.post(`/client-mgmt/leads/${drop.lead.id}/stage`, { stage: "LOST", lost_reason: v.reason }); toast.success("Marked lost"); await refresh(); }} />}
      {drop && drop.stage === "QUALIFIED" && <QualifyDialog open onOpenChange={(o) => !o && setDrop(null)} api={api} lead={drop.lead} clients={clients} onDone={refresh} />}
      {drop && drop.stage === "TENDER" && <PromptDialog open onOpenChange={(o) => !o && setDrop(null)} title="Open a tender" submitLabel="Open tender" fields={[{ key: "reference", label: "Tender reference" }, { key: "due_date", label: "Due date", type: "date" }]}
        onSubmit={async (v) => { try { await api.post(`/client-mgmt/leads/${drop.lead.id}/to-tender`, { reference: v.reference || null, due_date: v.due_date || null }); toast.success("Tender opened"); await refresh(); } catch (e) { throw e; } }} />}
      {drop && drop.stage === "PROPOSAL" && <PromptDialog open onOpenChange={(o) => !o && setDrop(null)} title="Create a proposal" submitLabel="Create" fields={[{ key: "title", label: "Proposal title", required: true, initial: `Proposal for ${drop.lead.company_name || drop.lead.client_name || ""}`.trim() }]}
        onSubmit={async (v) => { try { const { data } = await api.post(`/client-mgmt/leads/${drop.lead.id}/to-proposal`, { title: v.title, items: [] }); toast.success(`Proposal ${data.code} drafted`); await refresh(); setOpenLead(drop.lead.id); } catch (e) { throw e; } }} />}
    </div>
  );
}
