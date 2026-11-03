import { useCallback, useEffect, useState } from "react";
import { format, formatDistanceStrict } from "date-fns";
import { toast } from "sonner";
import { TerminalWindow, ListChecks, Gear, Lightning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canDo } from "@/lib/permissions";
import { TerminalPanel } from "@/components/ssh/TerminalPanel";
import { SshSetup } from "@/components/ssh/SshSetup";

const apiError = (e, f) => e.response?.data?.detail || f;

// Web SSH terminal for the L1 / L2 support teams. Access follows the "SSH Terminal" row of the permission matrix
// (View = open terminals if you're on the team, Edit = servers / logins / team / every session, Delete = remove) plus
// being on the L1 / L2 team. Sessions are logged and can be linked to a ticket.
export function SshTab({ api, user }) {
  const canEdit = canDo(user, "ssh", "edit");
  const canDelete = canDo(user, "ssh", "delete");
  const [view, setView] = useState("servers");
  const [servers, setServers] = useState([]);
  const [myLevel, setMyLevel] = useState(null);
  const [clients, setClients] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [pick, setPick] = useState(null);            // { server, level, tickets, ticketId }
  const [session, setSession] = useState(null);      // { server, level, ticketId } — the open terminal

  const load = useCallback(async () => {
    try { const { data } = await api.get("/ssh/servers"); setServers(data.servers); setMyLevel(data.my_level); }
    catch (e) { toast.error(apiError(e, "Failed to load servers")); }
  }, [api]);
  const loadSessions = useCallback(() => api.get("/ssh/sessions").then(r => setSessions(r.data)).catch(() => {}), [api]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canEdit) api.get("/tickets/clients").then(r => setClients(r.data)).catch(() => {}); }, [api, canEdit]);
  useEffect(() => { if (view === "sessions") loadSessions(); }, [view, loadSessions]);

  const startPick = async (server, level) => {
    let tickets = [];
    try { tickets = (await api.get(`/ssh/servers/${server.id}/tickets`)).data; } catch { /* linking a ticket is optional */ }
    setPick({ server, level, tickets, ticketId: "" });
  };
  const connect = () => { setSession({ server: pick.server, level: pick.level, ticketId: pick.ticketId ? Number(pick.ticketId) : 0 }); setPick(null); };
  const closeSession = () => { setSession(null); loadSessions(); };

  const tabButton = (key, label, Icon) => (
    <button key={key} onClick={() => setView(key)} data-testid={`ssh-view-${key}`} className="flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold"
      style={view === key ? { background: "var(--brand-primary)", color: "#fff" } : { background: "var(--surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
      <Icon className="h-4 w-4" weight="duotone" /> {label}
    </button>
  );

  if (session) return <TerminalPanel server={session.server} level={session.level} ticket={session.ticketId} onClose={closeSession} />;

  return (
    <>
      <div className="mb-6">
        <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">SSH Terminal</h1>
        <p className="text-slate-500 mt-1 text-sm">Fix client servers from the browser — logins stay stored and hidden, every session is logged</p>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">{tabButton("servers", "Servers", TerminalWindow)}{tabButton("sessions", "Session log", ListChecks)}{canEdit && tabButton("setup", "Setup", Gear)}</div>

      {view === "servers" && (
        <>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>{myLevel ? <>You're on the <strong>{myLevel.toUpperCase()}</strong> team.</> : "You're not on the L1 / L2 team yet, so you can't open terminals — ask an admin to add you."}</p>
          {servers.length === 0 ? <div className="section-card p-10 text-center text-sm text-slate-500">No servers have been set up yet.</div> : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {servers.map(s => (
                <div key={s.id} className="stat-card" data-testid={`ssh-server-${s.id}`} style={{ display: "block" }}>
                  <p className="font-bold font-['Outfit'] break-words">{s.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-subtle)" }}>{s.client_name} · {s.host}:{s.port}</p>
                  <div className="flex gap-2 mt-4">
                    {s.can_connect.length === 0 ? <p className="text-xs" style={{ color: "var(--text-subtle)" }}>{myLevel ? "No login available at your level" : "No access"}</p>
                      : s.can_connect.map(lv => <Button key={lv} size="sm" onClick={() => startPick(s, lv)} className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" data-testid={`connect-${s.id}-${lv}`}><Lightning className="h-3.5 w-3.5 mr-1" weight="fill" /> Connect as {lv.toUpperCase()}</Button>)}
                  </div>
                </div>))}
            </div>)}
        </>
      )}

      {view === "sessions" && (
        <div className="section-card overflow-x-auto">
          <table className="w-full min-w-[820px]"><thead><tr>{["When", "Who", "Server", "Login", "Ticket", "Duration", "Ended", "From"].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
            <tbody>
              {sessions.length === 0 && <tr><td colSpan={8} className="table-cell text-center text-sm text-slate-500 py-10">No sessions yet</td></tr>}
              {sessions.map(s => (
                <tr key={s.id} className="table-row" data-testid={`ssh-session-${s.id}`}>
                  <td className="table-cell text-xs whitespace-nowrap">{format(new Date(s.started_at), "d MMM, h:mm a")}</td>
                  <td className="table-cell text-sm">{s.user_name}</td>
                  <td className="table-cell text-sm"><p>{s.server_name}</p><p className="text-xs" style={{ color: "var(--text-subtle)" }}>{s.client_name}</p></td>
                  <td className="table-cell text-xs">{s.level.toUpperCase()} · {s.login_username}</td>
                  <td className="table-cell text-xs">{s.ticket_number || "—"}</td>
                  <td className="table-cell text-xs whitespace-nowrap">{s.ended_at ? formatDistanceStrict(new Date(s.started_at), new Date(s.ended_at)) : <span className="chip tone-green">live</span>}</td>
                  <td className="table-cell text-xs">{s.end_reason || "—"}</td>
                  <td className="table-cell text-xs">{s.ip || "—"}</td>
                </tr>))}
            </tbody></table>
        </div>
      )}

      {view === "setup" && canEdit && <SshSetup api={api} servers={servers} clients={clients} canDelete={canDelete} reload={load} />}

      <Dialog open={!!pick} onOpenChange={(o) => !o && setPick(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Connect to {pick?.server.name} as {pick?.level.toUpperCase()}</DialogTitle></DialogHeader>
          {pick && <div className="space-y-4">
            <div><Label>Ticket you're fixing (optional)</Label>
              <select className="w-full h-10 rounded-xl border px-3 text-sm bg-white" value={pick.ticketId} onChange={e => setPick({ ...pick, ticketId: e.target.value })} data-testid="ssh-ticket-select">
                <option value="">No ticket</option>{pick.tickets.map(t => <option key={t.id} value={t.id}>{t.number} — {t.subject}</option>)}</select>
              <p className="text-[11px] mt-1" style={{ color: "var(--text-subtle)" }}>Linking adds a note to the ticket when the session starts and ends.</p></div>
            <Button onClick={connect} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="ssh-connect-btn">Open terminal</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
