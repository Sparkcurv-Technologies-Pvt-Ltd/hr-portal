import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DownloadSimple, Warning, Info } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { saveBlobAsFile } from "@/lib/api";
import { apiError, money, moneyShort } from "../constants";

const SEVERITY = { high: { bg: "#FEF2F2", fg: "#991B1B", label: "Urgent" }, medium: { bg: "#FFFBEB", fg: "#92400E", label: "Soon" }, low: { bg: "var(--surface-elevated)", fg: "var(--text-muted)", label: "FYI" } };
const REPORTS = [["leads", "Leads", "sales"], ["accounts", "Accounts", "any"], ["opportunities", "Opportunities", "sales"], ["followups", "Follow-ups", "sales"], ["activity", "Activity log", "sales"],
                 ["proposals", "Proposals", "sales"], ["contracts", "Contracts", "any"], ["invoices", "Invoices", "acct"], ["payments", "Payments", "acct"], ["receivables", "Receivables", "acct"], ["ledger", "Client balances", "acct"]];
const STAGE_COLOR = { "Discovery": "#3B82F6", "Demo Completed": "#8B5CF6", "Pricing/POC Discussion": "#F59E0B", "Qualified": "#14B8A6", "Closed Won": "#16A34A", "Closed Lost": "#DC2626" };
const STATUS_COLOR = { New: "#3B82F6", Contacted: "#8B5CF6", Working: "#F59E0B", Qualified: "#14B8A6", Unqualified: "#DC2626", Converted: "#16A34A" };
const pct = (v) => (v == null ? "—" : `${v}%`);
const short = (s) => s.replace("Pricing/POC Discussion", "Pricing/POC").replace("Demo Completed", "Demo Done").replace("Trade Show / Exhibition", "Trade Show").replace("WhatsApp Inquiry", "WhatsApp");

const Kpi = ({ label, value, id, accent }) => (
  <div className="rounded-lg px-4 py-3 min-w-0" style={{ background: "var(--surface)", border: "1px solid var(--border-color)", borderTop: `3px solid ${accent}` }}>
    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
    <p className="text-2xl font-bold mt-1 truncate" data-testid={id}>{value}</p>
  </div>
);

function ChartCard({ title, sub, id, children, height = 240 }) {
  return (
    <section className="rounded-lg p-4 min-w-0" style={{ background: "var(--surface)", border: "1px solid var(--border-color)" }} data-testid={id}>
      <h3 className="font-bold text-sm font-['Outfit']">{title}</h3>{sub && <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{sub}</p>}
      <div style={{ height }} className="mt-2"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </section>
  );
}
const axis = { tick: { fontSize: 11, fill: "var(--text-muted)" }, tickLine: false, axisLine: { stroke: "var(--border-color)" } };
const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />;

// Overview: the sheet's dashboard as live bar charts, alerts, and CSV exports. Refreshes itself every minute.
export function OverviewSheet({ api, level, accounts, bdr, onAlert, refreshKey }) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => { try { setD((await api.get("/client-mgmt/dashboard", { params: bdr ? { owner_id: bdr } : {} })).data); } catch (e) { toast.error(apiError(e, "Couldn't load the overview")); } }, [api, bdr]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const exportCsv = async (name) => { try { const r = await api.get(`/client-mgmt/reports/${name}.csv`, { responseType: "blob" }); saveBlobAsFile(r.data, `${name}.csv`); } catch (e) { toast.error(apiError(e, "Couldn't export")); } };
  if (!d) return <p className="text-sm py-10 text-center" style={{ color: "var(--text-subtle)" }}>Loading…</p>;
  const o = d.crm;
  return (
    <div className="space-y-5 p-1" data-testid="dashboard-panel">
      {o && (
        <>
          <div><h2 className="font-bold font-['Outfit'] text-lg">Sales overview</h2><p className="text-xs" style={{ color: "var(--text-muted)" }}>A live snapshot of your leads, accounts, opportunities and activity — it updates as you work. As of {o.as_of}.</p></div>
          <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3" data-testid="crm-kpis">
            <Kpi label="Total Leads" value={o.total_leads} id="kpi-leads" accent="#3B82F6" /><Kpi label="Open Opportunities" value={o.open_opportunities} id="kpi-open" accent="#8B5CF6" />
            <Kpi label="Pipeline Value (INR)" value={moneyShort(o.pipeline_value)} id="kpi-pipeline" accent="#F59E0B" /><Kpi label="Closed Won (INR)" value={moneyShort(o.closed_won_value)} id="kpi-won" accent="#16A34A" />
            <Kpi label="Win Rate" value={pct(o.win_rate_pct)} id="kpi-win" accent="#14B8A6" /><Kpi label="Total Accounts" value={o.total_accounts} id="kpi-accounts" accent="#0EA5E9" />
            <Kpi label="Emails Sent Today" value={o.emails_today} id="kpi-emails" accent="#6366F1" /><Kpi label="Calls Completed Today" value={o.calls_today} id="kpi-calls" accent="#EC4899" />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard id="chart-pipeline-count" title="Pipeline by stage — number of opportunities">
              <BarChart data={o.pipeline_by_stage.map(s => ({ ...s, name: short(s.stage) }))} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} interval={0} /><YAxis allowDecimals={false} {...axis} /><Tooltip />
                <Bar dataKey="count" name="Opportunities" radius={[4, 4, 0, 0]}>{o.pipeline_by_stage.map(s => <Cell key={s.stage} fill={STAGE_COLOR[s.stage]} />)}<LabelList dataKey="count" position="top" fontSize={11} /></Bar></BarChart>
            </ChartCard>
            <ChartCard id="chart-pipeline-value" title="Pipeline by stage — value (INR)" sub="Deal value and probability-weighted value">
              <BarChart data={o.pipeline_by_stage.map(s => ({ ...s, name: short(s.stage) }))} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} interval={0} /><YAxis {...axis} tickFormatter={moneyShort} /><Tooltip formatter={(v) => money(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="value" name="Value" fill="#2563EB" radius={[4, 4, 0, 0]} /><Bar dataKey="weighted" name="Weighted" fill="#93C5FD" radius={[4, 4, 0, 0]} /></BarChart>
            </ChartCard>
            <ChartCard id="chart-sources" title="Leads by source">
              <BarChart data={o.leads_by_source.map(s => ({ ...s, name: short(s.source) }))} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} interval={0} angle={-20} textAnchor="end" height={50} /><YAxis allowDecimals={false} {...axis} /><Tooltip />
                <Bar dataKey="count" name="Leads" fill="#6366F1" radius={[4, 4, 0, 0]}><LabelList dataKey="count" position="top" fontSize={11} /></Bar></BarChart>
            </ChartCard>
            <ChartCard id="chart-status" title="Lead status">
              <BarChart data={o.lead_status.map(s => ({ ...s, name: s.status }))} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} interval={0} /><YAxis allowDecimals={false} {...axis} /><Tooltip />
                <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>{o.lead_status.map(s => <Cell key={s.status} fill={STATUS_COLOR[s.status]} />)}<LabelList dataKey="count" position="top" fontSize={11} /></Bar></BarChart>
            </ChartCard>
            <ChartCard id="chart-bdr" title="BDR activity — today" sub={o.bdr_activity_today.length ? undefined : "Nothing logged today yet"}>
              <BarChart data={o.bdr_activity_today.map(b => ({ ...b, name: b.bdr }))} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="emails" name="Emails" fill="#6366F1" radius={[4, 4, 0, 0]}><LabelList dataKey="emails" position="top" fontSize={11} /></Bar><Bar dataKey="calls" name="Calls" fill="#EC4899" radius={[4, 4, 0, 0]}><LabelList dataKey="calls" position="top" fontSize={11} /></Bar></BarChart>
            </ChartCard>
            <ChartCard id="chart-activity" title="Completed activity — last 14 days" sub="Emails, calls and WhatsApp per day">
              <BarChart data={o.activity_14d.map(a => ({ ...a, name: a.date.slice(5) }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} interval={1} /><YAxis allowDecimals={false} {...axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="emails" name="Emails" stackId="a" fill="#6366F1" /><Bar dataKey="calls" name="Calls" stackId="a" fill="#EC4899" /><Bar dataKey="whatsapp" name="WhatsApp" stackId="a" fill="#22C55E" radius={[4, 4, 0, 0]} /></BarChart>
            </ChartCard>
          </div>
        </>)}

      <section className="rounded-lg p-4" style={{ background: "var(--surface)", border: "1px solid var(--border-color)" }} data-testid="alerts">
        <h3 className="font-bold text-sm font-['Outfit'] mb-3">Needs attention {d.alerts.length > 0 && <span className="chip tone-red ml-1">{d.alerts.length}</span>}</h3>
        {d.alerts.length === 0 && <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Nothing needs attention right now.</p>}
        <div className="space-y-1.5 max-h-72 overflow-y-auto">{d.alerts.map((a, i) => { const s = SEVERITY[a.severity]; const clickable = a.followup_id || a.opportunity_id || a.proposal_id || a.contract_id || a.invoice_id; return (
          <button key={i} disabled={!clickable} onClick={() => onAlert(a)} data-testid={`alert-${a.kind}`} className="w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left text-sm" style={{ background: s.bg, color: s.fg, cursor: clickable ? "pointer" : "default" }}>
            {a.severity === "high" ? <Warning className="h-4 w-4 mt-0.5 flex-shrink-0" weight="fill" /> : <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />}<span className="flex-1 min-w-0 break-words">{a.message}</span><span className="text-[10px] font-bold uppercase flex-shrink-0">{s.label}</span></button>); })}</div>
      </section>

      {d.aging && (
        <div className="grid lg:grid-cols-2 gap-4">
          <ChartCard id="aging-chart" title="Receivables ageing" sub={`Outstanding ${money(d.aging.total)} · by days since invoice`}>
            <BarChart data={d.aging.buckets} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>{grid}<XAxis dataKey="bucket" {...axis} /><YAxis {...axis} tickFormatter={moneyShort} /><Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="amount" name="Outstanding" radius={[4, 4, 0, 0]}>{d.aging.buckets.map(b => <Cell key={b.bucket} fill={b.bucket === "0-30" ? "#16A34A" : b.bucket === "31-60" ? "#F59E0B" : "#DC2626"} />)}</Bar></BarChart>
          </ChartCard>
          {d.trend && <ChartCard id="trend-chart" title="Invoiced vs collected" sub="Last 6 months">
            <BarChart data={d.trend.map(t => ({ ...t, name: t.month.slice(2) }))} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>{grid}<XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={moneyShort} /><Tooltip formatter={(v) => money(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="invoiced" name="Invoiced" fill="#2563EB" radius={[4, 4, 0, 0]} /><Bar dataKey="collected" name="Collected" fill="#16A34A" radius={[4, 4, 0, 0]} /></BarChart>
          </ChartCard>}
        </div>)}

      <section className="rounded-lg p-4" style={{ background: "var(--surface)", border: "1px solid var(--border-color)" }} data-testid="exports"><h3 className="font-bold text-sm font-['Outfit'] mb-1">Export to CSV</h3><p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>The CRM exports use the sheet's own column headings, so they can be imported again.</p>
        <div className="flex flex-wrap gap-2">{REPORTS.filter(([, , need]) => need === "any" || (need === "sales" ? !!level : accounts)).map(([key, label]) => <Button key={key} size="sm" variant="outline" className="rounded-lg h-9" onClick={() => exportCsv(key)} data-testid={`export-${key}`}><DownloadSimple className="h-4 w-4 mr-1.5" /> {label}</Button>)}</div></section>
    </div>
  );
}
