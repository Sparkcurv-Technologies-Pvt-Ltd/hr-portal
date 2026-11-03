import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowsClockwise, Copy, Key, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API_BASE } from "@/lib/api";
import { Sparkline } from "./Sparkline";
import { StatusPill, TYPE_LABEL, STATUS, ago, apiError, describeTarget, pct } from "./constants";

const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Couldn't copy — select the text and copy it"); } };
const when = (iso) => format(new Date(iso), "d MMM, h:mm a");

// One monitor: current status, uptime, charts, install command for agents, and the incident history
export function MonitorDetail({ open, onOpenChange, api, monitorId, canEdit, canDelete, onChanged, freshToken, clearFreshToken }) {
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(null);   // shown once, right after it's created or rotated
  const origin = API_BASE || window.location.origin;

  const load = useCallback(async (isStale = () => false) => {
    const { data } = await api.get(`/monitoring/monitors/${monitorId}`);
    if (!isStale()) setM(data);
  }, [api, monitorId]);

  useEffect(() => {
    if (!open || !monitorId) return;
    let stale = false;
    setM(null); setToken(freshToken || null);
    load(() => stale).catch(e => { if (!stale) { toast.error(apiError(e, "Failed to load monitor")); onOpenChange(false); } });
    return () => { stale = true; };
  }, [open, monitorId, load, freshToken]);   // eslint-disable-line react-hooks/exhaustive-deps

  const checkNow = async () => {
    setBusy(true);
    try { const { data } = await api.post(`/monitoring/monitors/${monitorId}/check`); setM(data); onChanged(); toast.success(data.status === "up" ? "It's up" : `Result: ${STATUS[data.status]?.label || data.status}`); }
    catch (e) { toast.error(apiError(e, "Check failed")); } finally { setBusy(false); }
  };
  const rotate = async () => {
    if (!window.confirm("Create a new token? The agent using the old one stops reporting until you update it.")) return;
    try { const { data } = await api.post(`/monitoring/monitors/${monitorId}/rotate-token`); setToken(data.token); load().catch(() => {}); }
    catch (e) { toast.error(apiError(e, "Failed to create a token")); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${m.name} and its history?`)) return;
    try { await api.delete(`/monitoring/monitors/${monitorId}`); toast.success("Monitor deleted"); onOpenChange(false); onChanged(); }
    catch (e) { toast.error(apiError(e, "Failed to delete")); }
  };
  const close = (o) => { if (!o) { setToken(null); clearFreshToken?.(); } onOpenChange(o); };

  const checks = m?.checks || [];
  const install = `curl -fsSL ${origin}/api/monitoring/agent/script -o /opt/sparkcurv-agent.py\n` +
    `# then add to crontab (crontab -e):\n* * * * * MONITOR_URL=${origin}/api/monitoring/agent/report MONITOR_TOKEN=${token || "<token>"} /usr/bin/python3 /opt/sparkcurv-agent.py`;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{m ? <><span className="break-words">{m.name}</span><StatusPill status={m.status} /></> : "Monitor"}</DialogTitle></DialogHeader>
        {m && (
          <div className="space-y-5" data-testid="monitor-detail">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}><strong>{m.client_name}</strong> · {TYPE_LABEL[m.type]} · {describeTarget(m)}</p>
            {m.status === "down" && <div className="rounded-xl p-3 text-sm" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}>Down since {when(m.last_change_at)} — {m.last_error || "no response"}{m.open_ticket_number && <> · Ticket <strong>{m.open_ticket_number}</strong></>}</div>}

            <div className="grid grid-cols-3 gap-3">
              {[["24 hours", m.uptime["24h"]], ["7 days", m.uptime["7d"]], ["30 days", m.uptime["30d"]]].map(([label, v]) => (
                <div key={label} className="rounded-xl p-3 text-center" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>
                  <p className="text-xl font-bold">{pct(v)}</p><p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>Uptime · {label}</p></div>))}
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Last checked {ago(m.last_checked_at)}{m.last_response_ms != null && <> · {m.last_response_ms} ms</>}{m.type === "agent" && <> · last report {ago(m.last_agent_at)}</>}</p>

            {m.type === "agent" ? (
              <div className="space-y-3">
                {[["CPU", "cpu_percent", "#1F3BFF", m.cpu_max], ["Memory", "mem_percent", "#7C3AED", m.mem_max], ["Disk", "disk_percent", "#0D9488", m.disk_max]].map(([label, key, color, limit]) => (
                  <div key={key}>
                    <div className="flex justify-between text-xs mb-1"><span className="font-semibold">{label}</span><span style={{ color: (m[key] ?? 0) > limit ? "#E11D48" : "var(--text-muted)" }}>{m[key] == null ? "no data" : `${m[key]}% (limit ${limit}%)`}</span></div>
                    <Sparkline values={checks.map(c => c[key])} max={100} color={color} label={`${label} usage`} />
                  </div>))}
              </div>
            ) : (
              <div><p className="text-xs font-semibold mb-1">Response time (last 24 hours)</p><Sparkline values={checks.map(c => (c.ok ? c.response_ms : null))} color="#1F3BFF" label="Response time" /></div>
            )}

            {m.type === "agent" && canEdit && (
              <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }} data-testid="agent-install">
                <p className="text-sm font-bold">Install the agent on the client's server</p>
                <p className="text-xs text-slate-500">Linux, Python 3, no extra packages. It reports CPU, memory and disk once a minute.</p>
                {token && <p className="text-xs font-semibold" style={{ color: "#B45309" }}>Copy the token now — it won't be shown again.</p>}
                <pre className="text-[11px] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: "#0B1E5B", color: "#E2E8F0" }}>{install}</pre>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => copy(install)}><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy commands</Button>
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={rotate} data-testid="rotate-token-btn"><Key className="h-3.5 w-3.5 mr-1.5" /> {m.has_token ? "New token" : "Create token"}</Button>
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-bold mb-2">Recent events</p>
              {m.events.length === 0 ? <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Nothing yet</p> : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto" data-testid="monitor-events">
                  {m.events.map((e, i) => <p key={i} className="text-xs break-words"><StatusPill status={e.status} /> <span style={{ color: "var(--text-subtle)" }}>{when(e.created_at)}</span>{e.detail ? ` — ${e.detail}` : ""}</p>)}
                </div>)}
            </div>

            <div className="flex flex-wrap gap-2">
              {canDelete && <Button variant="outline" className="rounded-xl h-10 text-red-600" onClick={remove} aria-label="Delete monitor"><Trash className="h-4 w-4" /></Button>}
              {canEdit && m.type !== "agent" && <Button onClick={checkNow} disabled={busy} className="flex-1 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="check-now-btn"><ArrowsClockwise className="h-4 w-4 mr-1.5" /> {busy ? "Checking…" : "Check now"}</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
