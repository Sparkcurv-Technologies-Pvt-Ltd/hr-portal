import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MagnifyingGlass, ArrowCounterClockwise, FloppyDisk, LockSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/common/Avatar";
import { NO_ACCESS, PERMISSION_ACTIONS, PERMISSION_MODULES, toggleAction } from "@/lib/permissions";

// Columns shown. Create has no flag of its own: it is the same permission as Edit (anyone who can edit a module can add records to it).
const COLUMNS = [["view", "View", "view"], ["create", "Create", "edit"], ["edit", "Edit", "edit"], ["delete", "Delete", "delete"]];
const DESCRIPTIONS = {
  employees: "Employee list, profiles, onboarding and access",
  payroll: "Salary structures, payroll runs and payslips",
  finance: "Company income and expense entries",
  leaves: "Leave requests, approvals and balances",
  wfh: "Work-from-home requests and approvals",
  permissions: "Short permission (hours) requests and approvals",
  "change-requests": "Profile and data change requests",
  attendance: "Attendance records, corrections and reports",
  "org-chart": "Worker tree and reporting lines",
  policy: "Company policies and acknowledgements",
  holidays: "Holiday calendar",
  projects: "Projects, issues and boards",
  sales: "Leads, tenders, proposals, contracts and engagements",
  accounts: "Invoices, payments, advances and client ledger",
};

const samePerm = (a, b) => PERMISSION_ACTIONS.every(x => !!(a || NO_ACCESS)[x] === !!(b || NO_ACCESS)[x]);
const ALL_ON = { view: true, edit: true, delete: true };

// One person at a time: pick them, then tick View / Create / Edit / Delete for each module (admins always have full access, so they aren't listed)
export function AccessMatrix({ api }) {
  const [employees, setEmployees] = useState([]);
  const [original, setOriginal] = useState({});   // employee id -> {module: perm} as saved
  const [grid, setGrid] = useState({});           // employee id -> {module: perm} being edited
  const [selected, setSelected] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/access-matrix");
      const list = data.employees || [];
      const perms = Object.fromEntries(list.map(e => [e.id, e.permissions || {}]));
      setEmployees(list); setOriginal(perms); setGrid(perms);
      setSelected(cur => (cur && list.some(e => e.id === cur) ? cur : list[0]?.id || ""));
    } catch {
      toast.error("Failed to load access");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => employees.filter(e => roleFilter === "all" || e.role === roleFilter), [employees, roleFilter]);
  useEffect(() => { if (people.length && !people.some(e => e.id === selected)) setSelected(people[0].id); }, [people, selected]);
  const emp = employees.find(e => e.id === selected);
  const modules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PERMISSION_MODULES.filter(m => !q || m.label.toLowerCase().includes(q) || (DESCRIPTIONS[m.key] || "").toLowerCase().includes(q));
  }, [search]);

  const changedIds = useMemo(
    () => employees.map(e => e.id).filter(id => PERMISSION_MODULES.some(m => !samePerm(grid[id]?.[m.key], original[id]?.[m.key]))),
    [employees, grid, original]
  );
  const mineChanged = emp && changedIds.includes(emp.id);

  const setCell = (module, fn) => setGrid(prev => ({ ...prev, [selected]: { ...(prev[selected] || {}), [module]: fn(prev[selected]?.[module]) } }));
  const setAll = (value) => setGrid(prev => ({ ...prev, [selected]: Object.fromEntries(PERMISSION_MODULES.map(m => [m.key, value ? { ...ALL_ON } : { ...NO_ACCESS }])) }));
  const setRowAll = (module, value) => setCell(module, () => (value ? { ...ALL_ON } : { ...NO_ACCESS }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(changedIds.map(id => [id, grid[id] || {}]));
      const { data } = await api.put("/admin/access-matrix", body);
      toast.success(data?.message || "Access updated");
      setOriginal(grid);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save access");
    } finally {
      setSaving(false);
    }
  };

  const grantable = emp?.grantable;
  return (
    <div className="section-card" data-testid="access-matrix">
      <div className="section-header">
        <div className="min-w-0">
          <h2 className="text-base font-bold font-['Outfit']" style={{ color: 'var(--text-primary)' }}>Access</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Pick a person, then choose what they can do in each module. Edit or Delete includes View, and Create is the same permission as Edit. Nobody has access until you tick it. Only the superadmin can give access.
          </p>
        </div>
      </div>

      {/* Who */}
      <div className="p-4 sm:p-5 flex flex-wrap items-end gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex-1 min-w-[14rem]">
          <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-muted)' }} htmlFor="am-person">Person</label>
          <select id="am-person" data-testid="access-matrix-person" value={selected} onChange={e => setSelected(e.target.value)} className="w-full h-10 rounded-lg border px-3 text-sm" style={{ borderColor: 'var(--border-color)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
            {people.length === 0 && <option value="">No one</option>}
            {people.map(e => <option key={e.id} value={e.id}>{e.name} — {e.role === "manager" ? "Manager" : "Employee"}{e.department ? ` · ${e.department}` : ""}{changedIds.includes(e.id) ? " •" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-muted)' }} htmlFor="am-role">Show</label>
          <select id="am-role" data-testid="access-matrix-role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: 'var(--border-color)', background: 'var(--surface)', color: 'var(--text-secondary)' }}>
            <option value="all">Everyone</option><option value="employee">Employees</option><option value="manager">Managers</option>
          </select>
        </div>
        {emp && <div className="flex items-center gap-2.5 min-w-0 ml-auto"><Avatar url={emp.avatar_url} name={emp.name} size="h-9 w-9" textSize="text-xs" /><div className="min-w-0"><p className="text-sm font-semibold truncate">{emp.name}</p><p className="text-[11px] truncate" style={{ color: 'var(--text-subtle)' }}>{emp.email}</p></div></div>}
      </div>

      {/* Toolbar */}
      <div className="p-4 sm:p-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] sm:max-w-xs">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style={{ width: 15, height: 15 }} />
          <Input data-testid="access-matrix-search" placeholder="Search modules" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 rounded-lg text-sm" />
        </div>
        <Button variant="outline" size="sm" className="rounded-lg h-9" disabled={!grantable} onClick={() => setAll(true)} data-testid="access-select-all">Select all</Button>
        <Button variant="outline" size="sm" className="rounded-lg h-9" disabled={!grantable} onClick={() => setAll(false)} data-testid="access-clear-all">Clear all</Button>
      </div>

      {loading && <p className="text-center text-sm py-10" style={{ color: 'var(--text-subtle)' }}>Loading…</p>}
      {!loading && !emp && <p className="text-center text-sm py-10" style={{ color: 'var(--text-subtle)' }}>No one to show.</p>}
      {!loading && emp && !grantable && (
        <p className="mx-4 sm:mx-5 mb-5 rounded-xl p-3 text-sm inline-flex items-center gap-2" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }} data-testid={`matrix-locked-${emp.id}`}>
          <LockSimple className="h-4 w-4" weight="bold" /> Only the superadmin can give management access.
        </p>
      )}

      {!loading && emp && (
        <div className="overflow-x-auto px-4 sm:px-5 pb-5">
          <table className="w-full min-w-[640px]" style={{ border: '1px solid var(--border-color)', borderRadius: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="table-header text-left">Feature</th>
                {COLUMNS.map(([key, label]) => <th key={key} className="table-header text-center w-24">{label}</th>)}
                <th className="table-header w-24" />
              </tr>
            </thead>
            <tbody>
              {modules.map(m => {
                const cur = { ...NO_ACCESS, ...(grid[emp.id]?.[m.key] || {}) };
                const was = { ...NO_ACCESS, ...(original[emp.id]?.[m.key] || {}) };
                const dirty = !samePerm(cur, was);
                const allOn = cur.view && cur.edit && cur.delete;
                return (
                  <tr key={m.key} className="table-row" data-testid={`matrix-row-${m.key}`} style={dirty ? { background: 'var(--badge-amber-bg, #FFFBEB)' } : undefined}>
                    <td className="table-cell"><p className="text-sm font-semibold">{m.label}</p><p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{DESCRIPTIONS[m.key]}</p></td>
                    {COLUMNS.map(([key, label, action]) => (
                      <td key={key} className="table-cell text-center">
                        <input type="checkbox" className="h-4 w-4 accent-[#0020F8]" disabled={!grantable} data-testid={`matrix-${emp.id}-${m.key}-${key}`} aria-label={`${emp.name}: ${m.label} ${label}`}
                          checked={cur[action]} onChange={() => setCell(m.key, p => toggleAction(p, action))} />
                      </td>
                    ))}
                    <td className="table-cell text-center"><button type="button" disabled={!grantable} className="matrix-row-btn" data-testid={`matrix-row-toggle-${m.key}`} onClick={() => setRowAll(m.key, !allOn)}>{allOn ? "None" : "All"}</button></td>
                  </tr>);
              })}
              {modules.length === 0 && <tr><td colSpan={COLUMNS.length + 2} className="table-cell text-center py-8" style={{ color: 'var(--text-subtle)' }}>No module matches.</td></tr>}
            </tbody>
          </table>
        </div>)}

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-xs" style={{ color: changedIds.length ? 'var(--badge-amber-text)' : 'var(--text-muted)' }} data-testid="access-matrix-status">
          {changedIds.length ? `Unsaved changes for ${changedIds.length} ${changedIds.length === 1 ? "person" : "people"}${mineChanged ? "" : " (not this one)"}` : "Changes apply on their next login or reload"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-lg h-9" disabled={!changedIds.length || saving} onClick={() => setGrid(original)} data-testid="access-matrix-reset"><ArrowCounterClockwise className="h-4 w-4 mr-1.5" /> Cancel changes</Button>
          <Button size="sm" className="rounded-lg h-9 bg-[#0020F8] hover:bg-[#0019C4] text-white" disabled={!changedIds.length || saving} onClick={handleSave} data-testid="access-matrix-save"><FloppyDisk className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save permissions"}</Button>
        </div>
      </div>
    </div>
  );
}
