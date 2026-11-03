import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

// Which emails one person receives: everything on/off, or each kind of notification separately.
// Each switch saves straight away. (The company-wide switches in Email Settings still apply on top.)
export function EmailPrefsDialog({ open, onOpenChange, api, emp, onChanged }) {
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onOpenChange);   // the parent passes a new function every render; don't reload because of that
  closeRef.current = onOpenChange;
  const empId = emp?.id;

  useEffect(() => {
    if (!open || !empId) return;
    let stale = false;
    setPrefs(null);
    api.get(`/admin/employees/${empId}/email-notifications`).then(r => { if (!stale) setPrefs(r.data); })
      .catch(e => { if (!stale) { toast.error(e.response?.data?.detail || "Failed to load email settings"); closeRef.current(false); } });
    return () => { stale = true; };
  }, [open, empId, api]);

  const save = async (body) => {
    setBusy(true);
    try {
      const { data } = await api.put(`/admin/employees/${emp.id}/email-notifications`, body);
      setPrefs(data);
      onChanged(emp.id, { email_notifications: data.email_notifications, email_muted_modules: data.modules.filter(m => !m.enabled).map(m => m.key) });
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Email notifications — {emp?.name}</DialogTitle></DialogHeader>
        {prefs && (
          <div className="space-y-4" data-testid="email-prefs">
            <div className="flex items-center gap-4 rounded-xl p-4" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">All emails for {emp?.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{prefs.email_notifications ? "On — choose below which kinds they receive." : "Off — nothing is emailed to this person."}</p>
              </div>
              <Switch checked={prefs.email_notifications} disabled={busy} onCheckedChange={v => save({ email_notifications: v })} aria-label="All emails" data-testid="prefs-switch-all" />
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-color)", opacity: prefs.email_notifications ? 1 : 0.55 }}>
              {prefs.modules.map((m, i) => (
                <div key={m.key} className="flex items-center gap-4 px-4 py-3" style={{ borderTop: i ? "1px solid var(--border-color)" : "none" }} data-testid={`prefs-row-${m.key}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{m.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                  </div>
                  <Switch checked={m.enabled} disabled={busy || !prefs.email_notifications} onCheckedChange={v => save({ modules: { [m.key]: v } })} aria-label={m.label} data-testid={`prefs-switch-${m.key}`} />
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
