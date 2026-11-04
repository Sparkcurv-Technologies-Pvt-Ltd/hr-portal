import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DownloadSimple, Warning, Info } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { saveBlobAsFile } from "@/lib/api";
import { STAGES, apiError, money } from "./constants";

const SEVERITY = { high: { bg: "#FEF2F2", fg: "#991B1B", label: "Urgent" }, medium: { bg: "#FFFBEB", fg: "#92400E", label: "Soon" }, low: { bg: "var(--surface-elevated)", fg: "var(--text-muted)", label: "FYI" } };
const REPORTS = [["leads", "Leads", "sales"], ["proposals", "Proposals", "sales"], ["contracts", "Contracts", "any"], ["invoices", "Invoices", "acct"], ["payments", "Payments", "acct"], ["receivables", "Receivables", "acct"], ["ledger", "Client balances", "acct"]];
const pct = (v) => (v == null ? "—" : `${v}%`);

function Bars({ rows, a, b, labelA, labelB }) {
  const max = Math.max(1, ...rows.flatMap(r => [r[a], r[b]]));
  return (
    <div className="overflow-x-auto"><div className="flex items-end gap-3 h-40 min-w-[320px]" role="img" aria-label={`${labelA} and ${labelB} by month`}>
      {rows.map(r => (
        <div key={r.month} className="flex-1 flex flex-col items-center gap-1 min-w-[40px]">
          <div className="flex items-end gap-1 h-32 w-full justify-center">
            <div title={`${labelA} ${money(r[a])}`} style={{ height: `${(r[a] / max) * 100}%`, minHeight: r[a] ? 2 : 0, width: "40%", background: "#0020F8", borderRadius: "4px 4px 0 0" }} />
            <div title={`${labelB} ${money(r[b])}`} style={{ height: `${(r[b] / max) * 100}%`, minHeight: r[b] ? 2 : 0, width: "40%", background: "#059669", borderRadius: "4px 4px 0 0" }} />
          </div>
          <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>{r.month.slice(2)}</span>
        </div>))}
    </div></div>
  );
}

// KPI dashboard: numbers, alerts that need someone, receivables ageing, 6-month trend, CSV exports
export function DashboardPanel({ api, sales, accounts, onAlert }) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => { try { setD((await api.get("/client-mgmt/dashboard")).data); } catch (e) { toast.error(apiError(e, "Couldn't load the dashboard")); } }, [api]);
  useEffect(() => { load(); }, [load]);
  const exportCsv = async (name) => { try { const r = await api.get(`/client-mgmt/reports/${name}.csv`, { responseType: "blob" }); saveBlobAsFile(r.data, `${name}.csv`); } catch (e) { toast.error(apiError(e, "Couldn't export")); } };
  if (!d) return <p className="text-sm py-10 text-center" style={{ color: "var(--text-subtle)" }}>Loading…</p>;
  const k = d.kpis;
  const stages = k.pipeline_value_by_stage;
  const maxStage = stages ? Math.max(1, ...Object.values(stages).map(s => s.value)) : 1;
  const agingMax = d.aging ? Math.max(1, ...d.aging.buckets.map(b => b.amount)) : 1;
  return (
    <div className="space-y-5" data-testid="dashboard-panel">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {sales && <><div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Lead → proposal</p><p className="text-xl font-bold" data-testid="dash-l2p">{pct(k.lead_to_proposal_pct)}</p></div>
          <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Win rate</p><p className="text-xl font-bold" data-testid="dash-win">{pct(k.win_rate_pct)}</p></div>
          <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Avg days lead → PO</p><p className="text-xl font-bold" data-testid="dash-days">{k.avg_days_lead_to_po ?? "—"}</p></div></>}
        {accounts && <div className="stat-card justify-between min-h-[96px]"><p className="text-xs" style={{ color: "var(--text-muted)" }}>Overdue 60+ days</p><p className="text-xl font-bold" style={{ color: k.receivables_overdue_60?.amount ? "#E11D48" : undefined }} data-testid="dash-overdue">{k.receivables_overdue_60 ? money(k.receivables_overdue_60.amount) : "—"}</p></div>}
      </div>

      <section className="section-card p-4 sm:p-5" data-testid="alerts">
        <h3 className="font-bold font-['Outfit'] mb-3">Needs attention {d.alerts.length > 0 && <span className="chip tone-red ml-1">{d.alerts.length}</span>}</h3>
        {d.alerts.length === 0 && <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Nothing needs attention right now.</p>}
        <div className="space-y-1.5 max-h-80 overflow-y-auto">{d.alerts.map((a, i) => { const s = SEVERITY[a.severity]; const clickable = a.lead_id || a.proposal_id || a.contract_id || a.invoice_id; return (
          <button key={i} disabled={!clickable} onClick={() => onAlert(a)} data-testid={`alert-${a.kind}`} className="w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left text-sm" style={{ background: s.bg, color: s.fg, cursor: clickable ? "pointer" : "default" }}>
            {a.severity === "high" ? <Warning className="h-4 w-4 mt-0.5 flex-shrink-0" weight="fill" /> : <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />}<span className="flex-1 min-w-0 break-words">{a.message}</span><span className="text-[10px] font-bold uppercase flex-shrink-0">{s.label}</span></button>); })}</div>
      </section>

      <div className="grid lg:grid-cols-2 gap-5">
        {stages && <section className="section-card p-4 sm:p-5" data-testid="pipeline-chart"><h3 className="font-bold font-['Outfit'] mb-3">Pipeline value by stage</h3>
          <div className="space-y-2">{STAGES.map(s => <div key={s.key} className="flex items-center gap-2 text-xs"><span className="w-20 flex-shrink-0">{s.label}</span><div className="flex-1 h-5 rounded" style={{ background: "var(--surface-elevated)" }}><div className="h-5 rounded" style={{ width: `${(stages[s.key].value / maxStage) * 100}%`, minWidth: stages[s.key].value ? 3 : 0, background: s.key === "LOST" ? "#E11D48" : s.key === "WON" ? "#059669" : "#0020F8" }} /></div><span className="w-28 text-right flex-shrink-0">{money(stages[s.key].value)} <span style={{ color: "var(--text-subtle)" }}>({stages[s.key].count})</span></span></div>)}</div></section>}
        {d.aging && <section className="section-card p-4 sm:p-5" data-testid="aging-chart"><h3 className="font-bold font-['Outfit'] mb-1">Receivables ageing</h3><p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Outstanding {money(d.aging.total)} · by days since invoice</p>
          <div className="space-y-2">{d.aging.buckets.map(b => <div key={b.bucket} className="flex items-center gap-2 text-xs"><span className="w-14 flex-shrink-0">{b.bucket}</span><div className="flex-1 h-5 rounded" style={{ background: "var(--surface-elevated)" }}><div className="h-5 rounded" style={{ width: `${(b.amount / agingMax) * 100}%`, minWidth: b.amount ? 3 : 0, background: b.bucket === "0-30" ? "#059669" : b.bucket === "31-60" ? "#D97706" : "#E11D48" }} /></div><span className="w-28 text-right flex-shrink-0">{money(b.amount)}</span></div>)}</div>
          {d.aging.clients.length > 0 && <div className="mt-3 text-xs space-y-0.5">{d.aging.clients.slice(0, 5).map(c => <p key={c.client_id} className="flex justify-between gap-2"><span className="truncate">{c.client}</span><span>{money(c.total)}</span></p>)}</div>}</section>}
      </div>

      {d.trend && <section className="section-card p-4 sm:p-5" data-testid="trend-chart"><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 className="font-bold font-['Outfit']">Invoiced vs collected</h3><span className="text-xs flex gap-3"><span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: "#0020F8" }} />Invoiced</span><span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: "#059669" }} />Collected</span></span></div><Bars rows={d.trend} a="invoiced" b="collected" labelA="Invoiced" labelB="Collected" /></section>}

      <section className="section-card p-4 sm:p-5" data-testid="exports"><h3 className="font-bold font-['Outfit'] mb-3">Export to CSV</h3>
        <div className="flex flex-wrap gap-2">{REPORTS.filter(([, , need]) => need === "any" || (need === "sales" ? sales : accounts)).map(([key, label]) => <Button key={key} size="sm" variant="outline" className="rounded-lg h-9" onClick={() => exportCsv(key)} data-testid={`export-${key}`}><DownloadSimple className="h-4 w-4 mr-1.5" /> {label}</Button>)}</div></section>
    </div>
  );
}
