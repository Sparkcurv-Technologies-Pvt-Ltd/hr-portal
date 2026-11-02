import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NO_ACCESS, PERMISSION_ACTIONS, PERMISSION_MODULES, toggleAction } from "@/lib/permissions";

// Admin-only editor for one employee's module permissions (View / Edit / Delete).
// Edit or Delete automatically includes View; clearing View clears all three.
export function AccessDialog({ api, employee, open, onOpenChange }) {
  const [perms, setPerms] = useState({});
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !employee) return;
    setLoadingPerms(true);
    api.get(`/admin/employees/${employee.id}/permissions`)
      .then(r => setPerms(r.data?.permissions || {}))
      .catch(() => { setPerms({}); toast.error("Failed to load permissions"); })
      .finally(() => setLoadingPerms(false));
  }, [open, employee, api]);

  const toggle = (module, action) => {
    setPerms(prev => ({ ...prev, [module]: toggleAction(prev[module], action) }));
  };

  const setAll = (value) => {
    setPerms(Object.fromEntries(PERMISSION_MODULES.map(m => [m.key, { view: value, edit: value, delete: value }])));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/employees/${employee.id}/permissions`, perms);
      toast.success(`Access updated for ${employee.name}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl rounded-2xl" data-testid="access-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Outfit']">
            <span className="stat-icon tone-blue" style={{ width: 34, height: 34, borderRadius: 10 }}>
              <ShieldCheck className="h-[18px] w-[18px]" weight="duotone" />
            </span>
            Access — {employee?.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-1">
          Choose what this employee can do in the management panel. Changes apply the next time they log in or reload.
        </p>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" size="sm" className="rounded-lg h-8" onClick={() => setAll(true)} data-testid="access-grant-all">Grant all</Button>
          <Button type="button" variant="outline" size="sm" className="rounded-lg h-8" onClick={() => setAll(false)} data-testid="access-clear-all">Clear all</Button>
        </div>

        <div className="section-card" style={{ boxShadow: "none" }}>
          <div>
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Module</th>
                {PERMISSION_ACTIONS.map(a => (
                  <th key={a} className="table-header text-center capitalize" style={{ textAlign: "center" }}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MODULES.map(m => {
                const p = { ...NO_ACCESS, ...(perms[m.key] || {}) };
                return (
                  <tr key={m.key} className="table-row">
                    <td className="table-cell font-semibold" style={{ color: "var(--text-primary)" }}>{m.label}</td>
                    {PERMISSION_ACTIONS.map(a => (
                      <td key={a} className="table-cell text-center">
                        <input
                          type="checkbox"
                          data-testid={`access-${m.key}-${a}`}
                          aria-label={`${m.label} ${a}`}
                          checked={p[a]}
                          disabled={loadingPerms}
                          onChange={() => toggle(m.key, a)}
                          className="h-4 w-4 accent-[#0020F8] cursor-pointer"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            data-testid="access-save"
            onClick={handleSave}
            disabled={saving || loadingPerms}
            className="rounded-xl bg-[#0020F8] hover:bg-[#0019C4] text-white"
          >
            {saving ? "Saving…" : "Save Access"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
