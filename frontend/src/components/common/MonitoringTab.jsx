import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, MagnifyingGlass, PencilSimple, Pulse, Warning, WifiSlash, CheckCircle, Hourglass } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canDo } from "@/lib/permissions";
import { MonitorDialog } from "@/components/monitoring/MonitorDialog";
import { MonitorDetail } from "@/components/monitoring/MonitorDetail";
import { StatusPill, STATUS, TYPE_LABEL, ago, apiError, describeTarget, pct } from "@/components/monitoring/constants";

const REFRESH_MS = 30000;

// Client server monitoring. Access follows the "Server Monitoring" row of the permission matrix:
// View = see monitors and history, Edit = add / change / pause / check now / agent tokens, Delete = remove.
export function MonitoringTab({ api, user }) {
  const canEdit = canDo(user, "monitoring", "edit");
  const canDelete = canDo(user, "monitoring", "delete");
  const [summary, setSummary] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ q: "", status: "", client_id: "" });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [freshToken, setFreshToken] = useState(null);
  const seq = useRef(0);   // only the latest request may update the list

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ""));
      const [list, sum] = await Promise.all([api.get("/monitoring/monitors", { params }), api.get("/monitoring/summary")]);
      if (mine !== seq.current) return;
      setMonitors(list.data); setSummary(sum.data);
    } catch (e) { if (mine === seq.current) toast.error(apiError(e, "Failed to load monitors")); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [api, filters]);

  useEffect(() => { const id = setTimeout(load, filters.q ? 250 : 0); return () => clearTimeout(id); }, [load, filters.q]);
  useEffect(() => { const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);
  useEffect(() => { api.get("/tickets/clients").then(r => setClients(r.data)).catch(() => {}); }, [api]);

  const openDetail = (id, token = null) => { setFreshToken(token); setDetailId(id); setDetailOpen(true); };
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const cards = [["Up", "up", CheckCircle, "tone-green"], ["Down", "down", WifiSlash, "tone-red"], ["Degraded", "degraded", Warning, "tone-amber"], ["Waiting", "unknown", Hourglass, "tone-violet"]];
  const cls = "h-9 rounded-xl border px-2.5 text-sm bg-white min-w-0";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Server Monitoring</h1>
          <p className="text-slate-500 mt-1 text-sm">Watch your clients' websites, ports and servers — get alerted and ticketed when something goes down</p></div>
        {canEdit && <Button data-testid="add-monitor-btn" onClick={() => { setEditing(null); setFormOpen(true); }} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> Add monitor</Button>}
      </div>

      {summary && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6" data-testid="monitor-summary">
          {cards.map(([label, key, Icon, tone]) => (
            <button key={key} onClick={() => set("status", filters.status === key ? "" : key)} className={`stat-card ${tone} text-left`} style={{ display: "block", outline: filters.status === key ? "2px solid var(--brand-primary)" : "none" }}>
              <div className="flex items-center justify-between"><span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{label}</span><Icon className="h-5 w-5" style={{ color: "var(--tone)" }} weight="duotone" /></div>
              <p className="text-3xl font-bold mt-2" style={{ color: "var(--tone)" }}>{summary[key]}</p>
            </button>))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="monitor-filters">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <MagnifyingGlass className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-subtle)" }} />
          <Input value={filters.q} onChange={e => set("q", e.target.value)} placeholder="Search name, address or client" className="h-9 pl-9 rounded-xl" data-testid="monitor-search" /></div>
        <select className={cls} value={filters.client_id} onChange={e => set("client_id", e.target.value)} aria-label="Client"><option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className={cls} value={filters.status} onChange={e => set("status", e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
      </div>

      <div className="section-card overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr>{["Status", "Monitor", "Client", "Type", "Uptime 24h", "Response", "Last check", ""].map((h, i) => <th key={i} className="table-header">{h}</th>)}</tr></thead>
          <tbody>
            {!loading && monitors.length === 0 && <tr><td colSpan={8}><div className="flex flex-col items-center text-center py-14 px-6 gap-3"><span className="stat-icon tone-blue"><Pulse className="h-5 w-5" weight="duotone" /></span>
              <p className="text-sm font-semibold text-slate-900">{Object.values(filters).some(Boolean) ? "No monitors match" : "No monitors yet"}</p>{canEdit && !Object.values(filters).some(Boolean) && <p className="text-xs text-slate-500">Add a client's website, port or server to start watching it.</p>}</div></td></tr>}
            {monitors.map(m => (
              <tr key={m.id} className="table-row cursor-pointer" onClick={() => openDetail(m.id)} data-testid={`monitor-row-${m.id}`}>
                <td className="table-cell"><StatusPill status={m.status} /></td>
                <td className="table-cell"><p className="font-medium break-words">{m.name}</p><p className="text-xs break-all" style={{ color: "var(--text-subtle)" }}>{describeTarget(m)}</p></td>
                <td className="table-cell text-sm">{m.client_name}</td>
                <td className="table-cell text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{TYPE_LABEL[m.type].split(" (")[0]}</td>
                <td className="table-cell text-sm font-semibold">{pct(m.uptime_24h)}</td>
                <td className="table-cell text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{m.type === "agent" ? (m.cpu_percent != null ? `CPU ${m.cpu_percent}% · RAM ${m.mem_percent}%` : "—") : m.last_response_ms != null ? `${m.last_response_ms} ms` : "—"}</td>
                <td className="table-cell text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{ago(m.last_checked_at)}</td>
                <td className="table-cell text-right" onClick={e => e.stopPropagation()}>{canEdit && <button className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Edit monitor" onClick={() => { setEditing(m); setFormOpen(true); }}><PencilSimple className="h-4 w-4" /></button>}</td>
              </tr>))}
          </tbody>
        </table>
      </div>

      <MonitorDialog open={formOpen} onOpenChange={setFormOpen} api={api} clients={clients} monitor={editing}
        onSaved={(created) => { load(); if (created?.token) openDetail(created.id, created.token); }} />
      <MonitorDetail open={detailOpen} onOpenChange={setDetailOpen} api={api} monitorId={detailId} canEdit={canEdit} canDelete={canDelete} onChanged={load}
        freshToken={freshToken} clearFreshToken={() => setFreshToken(null)} />
    </>
  );
}
