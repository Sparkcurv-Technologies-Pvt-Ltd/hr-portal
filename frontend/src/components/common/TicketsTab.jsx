import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, MagnifyingGlass, X, Headset, ChartBar, ListChecks, Buildings } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canDo } from "@/lib/permissions";
import { WorkflowInfo } from "@/components/projects/WorkflowInfo";
import { TicketDialog } from "@/components/tickets/TicketDialog";
import { TicketDashboard } from "@/components/tickets/TicketDashboard";
import { ClientsPanel } from "@/components/tickets/ClientsPanel";
import { STATUSES, PRIORITIES, CATEGORIES, STATUS, PRIORITY, CATEGORY_LABEL, Pill, when, apiError } from "@/components/tickets/constants";
import { Avatar } from "@/components/common/Avatar";

const EMPTY_FILTERS = { q: "", status: "", priority: "", category: "", client_id: "", assignee: "", overdue: false, open_only: false };

// Client support tickets for staff. Access follows the "Client Tickets" row of the permission matrix:
// View = every ticket and client (and work the tickets assigned to you), Edit = log/reply/assign/manage clients,
// Delete = delete. Without a grant the page isn't shown at all.
export function TicketsTab({ api, user }) {
  const canView = canDo(user, "tickets", "view");
  const canEdit = canDo(user, "tickets", "edit");
  const canDelete = canDo(user, "tickets", "delete");
  const seesAll = canView || canEdit;   // (the page itself requires View)

  const [view, setView] = useState(seesAll ? "dashboard" : "tickets");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [workflow, setWorkflow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const requestSeq = useRef(0);   // only the latest request may update the screen (earlier, slower ones are ignored)
  const loadTickets = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "" && v !== false));
      const [t, s] = await Promise.all([api.get("/tickets", { params }), api.get("/tickets/stats")]);
      if (seq !== requestSeq.current) return;
      setTickets(t.data); setStats(s.data);
    } catch (e) { if (seq === requestSeq.current) toast.error(apiError(e, "Failed to load tickets")); }
    finally { if (seq === requestSeq.current) setLoading(false); }
  }, [api, filters]);
  const loadClients = useCallback(() => { if (seesAll) api.get("/tickets/clients").then(r => setClients(r.data)).catch(() => {}); }, [api, seesAll]);

  useEffect(() => { const id = setTimeout(loadTickets, filters.q ? 250 : 0); return () => clearTimeout(id); }, [loadTickets, filters.q]);
  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { api.get("/tickets/meta").then(r => { setStaff(r.data.staff); setWorkflow(r.data.workflow); }).catch(() => {}); }, [api]);

  const refresh = () => { loadTickets(); loadClients(); };
  const open = (id) => { setOpenId(id); setDialogOpen(true); };
  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const filtersActive = useMemo(() => Object.values(filters).some(v => v !== "" && v !== false), [filters]);
  const cls = "h-9 rounded-xl border px-2.5 text-sm bg-white min-w-0";

  const tabButton = (key, label, Icon) => (
    <button key={key} onClick={() => setView(key)} data-testid={`tickets-view-${key}`} className="flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold"
      style={view === key ? { background: "var(--brand-primary)", color: "#fff" } : { background: "var(--surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
      <Icon className="h-4 w-4" weight="duotone" /> {label}
    </button>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Client Tickets</h1>
          <p className="text-slate-500 mt-1 text-sm">{seesAll ? "Support tickets from your clients — track, assign and resolve them" : "Client tickets assigned to you"}</p>
        </div>
        <div className="flex gap-2"><WorkflowInfo title="Ticket workflow" statuses={STATUSES} workflow={workflow} />
        {canEdit && <Button data-testid="new-ticket-btn" onClick={() => open(null)} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> New ticket</Button>}</div>
      </div>

      {seesAll && <div className="flex flex-wrap gap-2 mb-5">{tabButton("dashboard", "Dashboard", ChartBar)}{tabButton("tickets", "Tickets", ListChecks)}{tabButton("clients", "Clients", Buildings)}</div>}

      {view === "dashboard" && seesAll && <TicketDashboard stats={stats} onFilter={(f) => { setFilters({ ...EMPTY_FILTERS, ...f }); setView("tickets"); }} />}
      {view === "clients" && seesAll && <ClientsPanel api={api} clients={clients} canEdit={canEdit} canDelete={canDelete} reload={refresh} />}

      {view === "tickets" && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="ticket-filters">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <MagnifyingGlass className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-subtle)" }} />
              <Input value={filters.q} onChange={e => setF("q", e.target.value)} placeholder="Search subject, client or TKT-0001" className="h-9 pl-9 rounded-xl" data-testid="ticket-search" />
            </div>
            <select className={cls} value={filters.status} onChange={e => setF("status", e.target.value)} aria-label="Status" data-testid="filter-status"><option value="">All statuses</option>{STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            <select className={cls} value={filters.priority} onChange={e => setF("priority", e.target.value)} aria-label="Priority"><option value="">All priorities</option>{PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            <select className={cls} value={filters.category} onChange={e => setF("category", e.target.value)} aria-label="Category"><option value="">All categories</option>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            {seesAll && <select className={cls} value={filters.client_id} onChange={e => setF("client_id", e.target.value)} aria-label="Client"><option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            {seesAll && <select className={cls} value={filters.assignee} onChange={e => setF("assignee", e.target.value)} aria-label="Assignee"><option value="">Any assignee</option><option value="none">Unassigned</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
            <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={filters.open_only} onChange={e => setF("open_only", e.target.checked)} data-testid="filter-open-only" /> Open only</label>
            <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={filters.overdue} onChange={e => setF("overdue", e.target.checked)} /> Overdue only</label>
            {filtersActive && <button onClick={() => setFilters(EMPTY_FILTERS)} className="flex items-center gap-1 text-xs font-semibold h-9 px-2" style={{ color: "var(--brand-primary)" }}><X className="h-3.5 w-3.5" weight="bold" /> Clear</button>}
          </div>
          <div className="section-card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr>{["Ticket", "Subject", "Priority", "Status", "Assignee", "Due", "Updated"].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
              <tbody>
                {!loading && tickets.length === 0 && <tr><td colSpan={7}><div className="flex flex-col items-center text-center py-14 px-6 gap-3"><span className="stat-icon tone-blue"><Headset className="h-5 w-5" weight="duotone" /></span><p className="text-sm font-semibold text-slate-900">{filtersActive ? "No tickets match" : "No tickets yet"}</p></div></td></tr>}
                {tickets.map(t => (
                  <tr key={t.id} className="table-row cursor-pointer" onClick={() => open(t.id)} data-testid={`ticket-row-${t.id}`}>
                    <td className="table-cell font-semibold whitespace-nowrap">{t.number}</td>
                    <td className="table-cell"><p className="font-medium break-words">{t.subject}</p><p className="text-xs" style={{ color: "var(--text-subtle)" }}>{t.client_name} · {CATEGORY_LABEL[t.category]}{t.reply_count ? ` · ${t.reply_count} repl${t.reply_count === 1 ? "y" : "ies"}` : ""}</p></td>
                    <td className="table-cell"><Pill item={PRIORITY[t.priority]} /></td>
                    <td className="table-cell"><Pill item={STATUS[t.status]} /></td>
                    <td className="table-cell">{t.assignee_name ? <span className="flex items-center gap-1.5"><Avatar url={t.assignee_avatar} name={t.assignee_name} size="h-6 w-6" textSize="text-[9px]" /><span className="text-sm">{t.assignee_name}</span></span> : <span style={{ color: "var(--text-subtle)" }}>Unassigned</span>}</td>
                    <td className="table-cell whitespace-nowrap text-xs font-semibold" style={{ color: t.overdue ? "#E11D48" : "var(--text-muted)" }}>{t.overdue ? "Overdue · " : ""}{when(t.due_at)}</td>
                    <td className="table-cell whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>{when(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <TicketDialog open={dialogOpen} onOpenChange={setDialogOpen} api={api} ticketId={openId} clients={clients} staff={staff} workflow={workflow} canEdit={canEdit} canDelete={canDelete} onChanged={refresh} />
    </>
  );
}
