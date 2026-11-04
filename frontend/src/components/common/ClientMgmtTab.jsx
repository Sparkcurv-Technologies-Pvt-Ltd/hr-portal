import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DownloadSimple, Link as LinkIcon, MagnifyingGlass, UploadSimple } from "@phosphor-icons/react";
import { saveBlobAsFile } from "@/lib/api";
import { WebFormDialog } from "@/components/clientmgmt/WebFormDialog";
import { ImportDialog } from "@/components/clientmgmt/ImportDialog";
import { OpportunityDialog } from "@/components/clientmgmt/OpportunityDialog";
import { OverviewSheet } from "@/components/clientmgmt/sheet/OverviewSheet";
import { LeadsSheet, AccountsSheet, OpportunitiesSheet } from "@/components/clientmgmt/sheet/CrmSheets";
import { FollowupsSheet, ActivitySheet, ListsSheet } from "@/components/clientmgmt/sheet/TrackerSheets";
import { ProposalsPanel, ContractsPanel } from "@/components/clientmgmt/SalesPanels";
import { InvoicesPanel, PaymentsPanel, AdvancesPanel, LedgerPanel } from "@/components/clientmgmt/AccountsPanels";
import { apiError } from "@/components/clientmgmt/constants";

// Client Management as a workbook: the Sales CRM sheets (Overview, Leads, Accounts, Opportunities, Follow-ups, Activity Log, Lists) with their tabs along the bottom like Excel,
// then the after-sale sheets (proposals → contracts → invoices → payments → advances → ledger). A BDR picker filters every CRM sheet, like the per-BDR copies of the workbook.
const CRM = [["dashboard", "Overview", "#16A34A"], ["leads", "Leads", "#2563EB"], ["accounts", "Accounts", "#0D9488"], ["opportunities", "Opportunities", "#EA580C"], ["followups", "Follow-ups", "#7C3AED"], ["activity", "Activity Log", "#DC2626"], ["lists", "Lists", "#6B7280"]];
const SALE = [["proposals", "Proposals", "#0284C7"], ["contracts", "Contracts", "#4F46E5"], ["invoices", "Invoices", "#CA8A04"], ["payments", "Payments", "#16A34A"], ["advances", "Advances", "#9333EA"], ["ledger", "Ledger", "#475569"]];
const REPORT = { leads: "leads", accounts: "accounts", opportunities: "opportunities", followups: "followups", activity: "activity", proposals: "proposals", contracts: "contracts", invoices: "invoices", payments: "payments", ledger: "ledger" };
const SEARCHABLE = ["leads", "accounts", "opportunities", "followups", "activity"];

export function ClientMgmtTab({ api, user }) {
  const flags = user.client_mgmt || {};
  const level = flags.sales || null;          // 'mgr' | 'sales' | 'viewer'
  const acct = flags.accounts || null;        // 'acct' | 'viewer'
  const allowed = (k) => ({ dashboard: true, accounts: true, leads: !!level, opportunities: !!level, followups: !!level, activity: !!level, lists: true, proposals: !!level, contracts: !!level || !!acct, invoices: !!acct, payments: !!acct, advances: !!acct, ledger: !!acct })[k];
  const crm = CRM.filter(([k]) => allowed(k)), sale = SALE.filter(([k]) => allowed(k));
  const [view, setView] = useState("dashboard");
  const [people, setPeople] = useState([]);
  const [bdr, setBdr] = useState("");
  const [search, setSearch] = useState("");
  const [oppId, setOppId] = useState(null);
  const [contractId, setContractId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [badges, setBadges] = useState({});
  const [webForm, setWebForm] = useState(false);
  const [importing, setImporting] = useState(false);
  const bump = useCallback(() => setRefreshKey(k => k + 1), []);
  useEffect(() => { api.get("/client-mgmt/people").then(r => setPeople(r.data)).catch(e => toast.error(apiError(e, "Couldn't load the people list"))); }, [api]);
  useEffect(() => {
    if (!level) return undefined;
    const load = () => api.get("/client-mgmt/badges", { params: bdr ? { owner_id: bdr } : {} }).then(r => setBadges(r.data)).catch(() => {});
    load(); const t = setInterval(load, 60000); return () => clearInterval(t);
  }, [api, level, bdr, refreshKey]);
  useEffect(() => { setSearch(""); }, [view]);

  const onAlert = (a) => {
    if (a.followup_id) return setView("followups");
    if (a.opportunity_id) return setOppId(a.opportunity_id);
    if (a.proposal_id) return setView("proposals");
    if (a.contract_id) { setContractId({ id: a.contract_id, n: Date.now() }); return setView("contracts"); }
    if (a.invoice_id) return setView("invoices");
  };
  const goTo = (v) => { setOppId(null); setView(v); };
  const exportSheet = async () => { try { const r = await api.get(`/client-mgmt/reports/${REPORT[view]}.csv`, { responseType: "blob" }); saveBlobAsFile(r.data, `${REPORT[view]}.csv`); } catch (e) { toast.error(apiError(e, "Couldn't export")); } };
  const common = { api, user, level, people, bdr, refreshKey, search, onChanged: bump, openOpp: setOppId };
  const badge = (k) => (k === "followups" ? badges.due_followups : k === "leads" ? badges.new_leads : 0);
  const Tab = ({ k, l, color }) => (
    <button role="tab" aria-selected={view === k} onClick={() => setView(k)} data-testid={`cm-view-${k}`} className="relative px-3.5 py-2.5 text-sm whitespace-nowrap flex items-center gap-1.5 -mb-px"
      style={{ fontWeight: view === k ? 700 : 500, color: view === k ? "var(--text-primary)" : "var(--text-muted)", borderBottom: `2px solid ${view === k ? color : "transparent"}` }}>
      {l}{badge(k) > 0 && <span className="rounded-full text-[10px] font-bold px-1.5 text-white" style={{ background: k === "followups" ? "#DC2626" : "#2563EB" }} data-testid={`badge-${k}`}>{badge(k)}</span>}
    </button>
  );
  const isCrm = SEARCHABLE.includes(view);

  return (
    <div className="space-y-4" data-testid="client-mgmt-tab">
      <div className="flex flex-wrap items-stretch" style={{ borderBottom: "1px solid var(--border-color)" }} role="tablist" data-testid="cm-views" aria-label="Client management sections">
        {crm.map(([k, l, c]) => <Tab key={k} k={k} l={l} color={c} />)}
        {sale.length > 0 && <span className="self-center text-[10px] font-bold uppercase tracking-wide px-3 whitespace-nowrap" style={{ color: "var(--text-subtle)" }}>After the sale ›</span>}
        {sale.map(([k, l, c]) => <Tab key={k} k={k} l={l} color={c} />)}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="cm-toolbar">
        {isCrm && <div className="relative"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input className="h-9 pl-9 w-60" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} data-testid="sheet-search" /></div>}
        {level && level !== "sales" && ["dashboard", "leads", "accounts", "opportunities", "followups", "activity"].includes(view) && (
          <label className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>BDR <select className="h-9 rounded-lg border px-2.5 text-sm bg-white" value={bdr} onChange={e => setBdr(e.target.value)} data-testid="bdr-filter"><option value="">All BDRs</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
        <div className="ml-auto flex flex-wrap gap-2">
          {isCrm && REPORT[view] && <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={exportSheet} data-testid="export-sheet"><DownloadSimple className="h-4 w-4 mr-1.5" /> Export CSV</Button>}
          {level && <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => setWebForm(true)} data-testid="web-form-link"><LinkIcon className="h-4 w-4 mr-1.5" /> Web form link</Button>}
          {level === "mgr" && <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => setImporting(true)} data-testid="import-workbook"><UploadSimple className="h-4 w-4 mr-1.5" /> Import workbook</Button>}
        </div>
      </div>

      <div data-testid="cm-body">
        {view === "dashboard" && <OverviewSheet api={api} level={level} accounts={!!acct} bdr={bdr} onAlert={onAlert} refreshKey={refreshKey} />}
        {view === "leads" && level && <LeadsSheet {...common} />}
        {view === "accounts" && <AccountsSheet {...common} />}
        {view === "opportunities" && level && <OpportunitiesSheet {...common} />}
        {view === "followups" && level && <FollowupsSheet {...common} />}
        {view === "activity" && level && <ActivitySheet {...common} />}
        {view === "lists" && <ListsSheet api={api} />}
        {view === "proposals" && level && <ProposalsPanel api={api} user={user} level={level} />}
        {view === "contracts" && <ContractsPanel key={contractId?.n || "all"} api={api} level={level} canAccounts={!!acct} openId={contractId?.id} />}
        {view === "invoices" && acct && <InvoicesPanel api={api} canEdit={acct === "acct"} />}
        {view === "payments" && acct && <PaymentsPanel api={api} canEdit={acct === "acct"} />}
        {view === "advances" && acct && <AdvancesPanel api={api} canEdit={acct === "acct"} />}
        {view === "ledger" && acct && <LedgerPanel api={api} />}
      </div>

      {oppId && <OpportunityDialog api={api} user={user} level={level} people={people} oppId={oppId} onClose={() => setOppId(null)} onChanged={bump} onGoTo={goTo} />}
      <WebFormDialog api={api} open={webForm} onOpenChange={setWebForm} />
      <ImportDialog api={api} open={importing} onOpenChange={setImporting} onDone={bump} />
    </div>
  );
}
