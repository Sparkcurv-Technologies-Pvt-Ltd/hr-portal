import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TYPES, INTERVALS, selectClass, apiError } from "./constants";

const EMPTY = { client_id: "", name: "", type: "http", target: "", port: "", expected_text: "", interval_seconds: 300, timeout_seconds: 10, fail_threshold: 2, enabled: true, auto_ticket: true, visible_to_client: true, cpu_max: 90, mem_max: 90, disk_max: 90 };

// Add or edit a monitor. A monitor's type is fixed once created.
export function MonitorDialog({ open, onOpenChange, api, clients, monitor, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(monitor ? { ...EMPTY, ...monitor, client_id: monitor.client_id, port: monitor.port ?? "" } : EMPTY);
  }, [open, monitor]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const num = (k) => (e) => set(k, e.target.value === "" ? "" : Number(e.target.value));

  const save = async () => {
    if (!form.client_id) return toast.error("Choose a client");
    if (!form.name.trim()) return toast.error("Enter a name");
    setSaving(true);
    try {
      const body = { ...form, client_id: Number(form.client_id), port: form.port === "" ? null : Number(form.port) };
      if (monitor) { await api.put(`/monitoring/monitors/${monitor.id}`, body); toast.success("Monitor updated"); onOpenChange(false); onSaved(); }
      else { const { data } = await api.post("/monitoring/monitors", body); toast.success("Monitor added"); onOpenChange(false); onSaved(data); }
    } catch (e) { toast.error(apiError(e, "Failed to save monitor")); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{monitor ? "Edit monitor" : "Add monitor"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1"><Label>Client</Label>
              <select className={selectClass} value={form.client_id} onChange={e => set("client_id", e.target.value)} data-testid="monitor-client-select">
                <option value="">Choose a client…</option>{clients.filter(c => c.status === "active" || c.id === monitor?.client_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="col-span-2 sm:col-span-1"><Label>What to monitor</Label>
              <select className={selectClass} value={form.type} disabled={!!monitor} onChange={e => set("type", e.target.value)} data-testid="monitor-type-select">
                {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
          </div>
          <div><Label>Name</Label><Input value={form.name} placeholder="e.g. Company website, Production DB" onChange={e => set("name", e.target.value)} data-testid="monitor-name-input" /></div>
          {form.type === "http" && (
            <>
              <div><Label>URL</Label><Input value={form.target} placeholder="https://client-site.com/health" onChange={e => set("target", e.target.value)} data-testid="monitor-target-input" /></div>
              <div><Label>Page must contain (optional)</Label><Input value={form.expected_text} placeholder="e.g. Welcome" onChange={e => set("expected_text", e.target.value)} /></div>
            </>
          )}
          {form.type === "tcp" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Label>Host or IP</Label><Input value={form.target} placeholder="server.client.com" onChange={e => set("target", e.target.value)} data-testid="monitor-target-input" /></div>
              <div><Label>Port</Label><Input type="number" min="1" max="65535" value={form.port} onChange={num("port")} data-testid="monitor-port-input" /></div>
            </div>
          )}
          {form.type === "agent" && (
            <div className="grid grid-cols-3 gap-3">
              {[["cpu_max", "CPU limit %"], ["mem_max", "Memory limit %"], ["disk_max", "Disk limit %"]].map(([k, label]) => (
                <div key={k}><Label>{label}</Label><Input type="number" min="1" max="100" value={form[k]} onChange={num(k)} /></div>))}
              <p className="col-span-3 text-[11px]" style={{ color: "var(--text-subtle)" }}>Above a limit the server shows as Degraded. After saving you'll get an install command with its token.</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div><Label>{form.type === "agent" ? "Expected every" : "Check every"}</Label>
              <select className={selectClass} value={form.interval_seconds} onChange={e => set("interval_seconds", Number(e.target.value))}>{INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            {form.type !== "agent" && <div><Label>Timeout (s)</Label><Input type="number" min="2" max="30" value={form.timeout_seconds} onChange={num("timeout_seconds")} /></div>}
            <div><Label>Down after</Label><Input type="number" min="1" max="10" value={form.fail_threshold} onChange={num("fail_threshold")} /><p className="text-[10px] mt-0.5" style={{ color: "var(--text-subtle)" }}>failed checks</p></div>
          </div>
          <div className="rounded-xl divide-y" style={{ border: "1px solid var(--border-color)" }}>
            {[["enabled", "Monitoring on", "Switch off to pause checks and alerts."], ["auto_ticket", "Open a ticket when it goes down", "An urgent ticket for the client, resolved automatically when it recovers."], ["visible_to_client", "Show status in the client portal", "The client sees the name, status and uptime (never the address)."]].map(([k, title, desc]) => (
              <div key={k} className="flex items-center gap-3 p-3" style={{ borderColor: "var(--border-color)" }}>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold">{title}</p><p className="text-xs text-slate-500">{desc}</p></div>
                <Switch checked={form[k]} onCheckedChange={v => set(k, v)} aria-label={title} data-testid={`monitor-switch-${k}`} />
              </div>))}
          </div>
          <Button onClick={save} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-monitor-btn">{saving ? "Saving…" : monitor ? "Save changes" : "Add monitor"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
