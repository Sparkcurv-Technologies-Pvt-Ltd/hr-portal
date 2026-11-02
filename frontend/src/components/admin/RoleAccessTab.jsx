import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AccessMatrix } from "@/components/admin/AccessMatrix";
import { toast } from "sonner";

export function RoleAccessTab({ api, rolePerms, setRolePerms, rolePermsLoading, setRolePermsLoading }) {
  // ── Role Permissions Handlers ───────────────────────────────────────
  const handleSaveRolePerms = async () => {
    setRolePermsLoading(true);
    try {
      await api.put("/admin/role-permissions", rolePerms);
      toast.success("Permissions saved!");
    } catch (e) {
      toast.error("Failed to save permissions");
    } finally {
      setRolePermsLoading(false);
    }
  };

  const [view, setView] = useState("matrix");

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Role Access Control</h1>
          <p className="text-slate-500 mt-1 text-sm">Grant each employee View, Edit or Delete access per module, and choose which portal tabs each role sees</p>
        </div>
      </div>

      <div className="inline-flex flex-wrap p-1 mb-6 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        {[["matrix", "Access Matrix"], ["tabs", "Portal Tabs by Role"]].map(([id, label]) => (
          <button
            key={id}
            data-testid={`role-access-view-${id}`}
            onClick={() => setView(id)}
            className={`px-4 h-9 rounded-lg text-sm font-semibold transition-colors ${view === id ? "bg-[#0020F8] text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "matrix" && <AccessMatrix api={api} />}

      {view === "tabs" && (<>

      {[
        {
          role: "manager",
          label: "Manager",
          color: "orange",
          features: [
            { key: "employees", label: "Employees Tab" },
            { key: "attendance", label: "Attendance Tab" },
            { key: "leaves", label: "Leave Requests" },
            { key: "wfh", label: "WFH Requests" },
            { key: "permissions", label: "Permissions" },
            { key: "change-requests", label: "Change Requests" },
            { key: "payroll", label: "Payroll (view)" },
            { key: "holidays", label: "Holidays" },
            { key: "policy", label: "Company Policy" },
          ]
        },
        {
          role: "employee",
          label: "Employee",
          color: "blue",
          features: [
            { key: "payslips", label: "Payslips" },
            { key: "salary", label: "My Salary" },
            { key: "change-requests", label: "Change Requests" },
            { key: "summary", label: "Work Summary" },
            { key: "wfh", label: "WFH Requests" },
            { key: "holidays", label: "Holidays" },
            { key: "policy", label: "Company Policy" },
          ]
        }
      ].map(({ role, label, color, features }) => (
        <div key={role} className="section-card mb-5">
          <div className="section-header" style={{ justifyContent: 'flex-start' }}>
            <span className={`chip uppercase tracking-wider ${
              color === 'orange' ? 'tone-amber' :
              color === 'purple' ? 'tone-violet' :
              'tone-blue'
            }`}>{label}</span>
            <p className="text-sm text-slate-500">Toggle which features this role can access</p>
          </div>
          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {features.map(({ key, label: flabel }) => {
              const enabled = rolePerms[role]?.[key] !== false; // default true
              return (
                <label key={key} className="flex items-center gap-3 cursor-pointer group rounded-xl border px-3 py-2.5 transition-colors" style={{ borderColor: 'var(--border-color)', background: enabled ? 'var(--surface-elevated)' : 'transparent' }}>
                  <button
                    data-testid={`perm-${role}-${key}`}
                    onClick={() => setRolePerms(p => ({ ...p, [role]: { ...p[role], [key]: !enabled } }))}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-[#0020F8]' : 'bg-slate-200'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className={`text-sm font-medium ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>{flabel}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <Button
        data-testid="save-role-perms-btn"
        onClick={handleSaveRolePerms}
        disabled={rolePermsLoading}
        className="bg-[#0020F8] text-white hover:bg-[#0019C4] px-8 h-11 rounded-xl"
      >
        {rolePermsLoading ? "Saving…" : "Save Permissions"}
      </Button>
      </>)}
    </>
  );
}
