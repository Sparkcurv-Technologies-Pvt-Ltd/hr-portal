import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MagnifyingGlass, ArrowCounterClockwise, FloppyDisk } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/common/Avatar";
import { NO_ACCESS, PERMISSION_ACTIONS, PERMISSION_MODULES, toggleAction } from "@/lib/permissions";

const ACTION_SHORT = { view: "V", edit: "E", delete: "D" };
const ACTION_LABEL = { view: "View", edit: "Edit", delete: "Delete" };

// Set (not flip) one action while keeping the View/Edit/Delete rules
function setAction(perm, action, value) {
  const cur = { ...NO_ACCESS, ...(perm || {}) };
  return cur[action] === value ? cur : toggleAction(cur, action);
}

const samePerm = (a, b) => PERMISSION_ACTIONS.every(x => !!(a || NO_ACCESS)[x] === !!(b || NO_ACCESS)[x]);

// Employees × modules grid of View / Edit / Delete grants (admins are not listed: they always have full access)
export function AccessMatrix({ api }) {
  const [employees, setEmployees] = useState([]);
  const [original, setOriginal] = useState({});   // employee id -> {module: perm} as saved
  const [grid, setGrid] = useState({});           // employee id -> {module: perm} being edited
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/access-matrix");
      const perms = Object.fromEntries((data.employees || []).map(e => [e.id, e.permissions || {}]));
      setEmployees(data.employees || []);
      setOriginal(perms);
      setGrid(perms);
    } catch {
      toast.error("Failed to load access matrix");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(e =>
      (roleFilter === "all" || e.role === roleFilter) &&
      (!q || [e.name, e.email, e.department, e.employee_code].some(v => (v || "").toLowerCase().includes(q)))
    );
  }, [employees, search, roleFilter]);

  const changedIds = useMemo(
    () => employees.map(e => e.id).filter(id => PERMISSION_MODULES.some(m => !samePerm(grid[id]?.[m.key], original[id]?.[m.key]))),
    [employees, grid, original]
  );

  const updateCell = (id, module, fn) =>
    setGrid(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [module]: fn(prev[id]?.[module]) } }));

  // Header click: turn the action on for every visible row, or off if all already have it
  const toggleColumn = (module, action) => {
    const allOn = visible.length > 0 && visible.every(e => grid[e.id]?.[module]?.[action]);
    setGrid(prev => {
      const next = { ...prev };
      visible.forEach(e => { next[e.id] = { ...(next[e.id] || {}), [module]: setAction(next[e.id]?.[module], action, !allOn) }; });
      return next;
    });
  };

  const setRow = (id, value) =>
    setGrid(prev => ({ ...prev, [id]: Object.fromEntries(PERMISSION_MODULES.map(m => [m.key, { view: value, edit: value, delete: value }])) }));

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

  return (
    <div className="section-card" data-testid="access-matrix">
      {/* Toolbar */}
      <div className="section-header">
        <div className="min-w-0">
          <h2 className="text-base font-bold font-['Outfit']" style={{ color: 'var(--text-primary)' }}>Access Matrix</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            V = View, E = Edit, D = Delete. Edit or Delete includes View. Click a column letter to toggle it for every listed employee. Admins always have full access.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none sm:w-56">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style={{ width: 15, height: 15 }} />
            <Input
              data-testid="access-matrix-search"
              placeholder="Search employees"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 rounded-lg text-sm"
            />
          </div>
          <select
            data-testid="access-matrix-role"
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="h-9 rounded-lg border px-2.5 text-sm"
            style={{ borderColor: 'var(--border-color)', background: 'var(--surface)', color: 'var(--text-secondary)' }}
          >
            <option value="all">All roles</option>
            <option value="employee">Employees</option>
            <option value="manager">Managers</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="access-matrix w-full">
          <thead>
            <tr>
              <th rowSpan={2} className="table-header matrix-sticky matrix-name-col">Employee</th>
              {PERMISSION_MODULES.map((m, i) => (
                <th key={m.key} colSpan={3} className={`table-header text-center matrix-group ${i % 2 ? "matrix-alt" : ""}`}>{m.label}</th>
              ))}
              <th rowSpan={2} className="table-header text-center">Row</th>
            </tr>
            <tr>
              {PERMISSION_MODULES.map((m, i) => PERMISSION_ACTIONS.map(a => (
                <th key={`${m.key}-${a}`} className={`table-header matrix-cell-head ${a === "view" ? "matrix-group" : ""} ${i % 2 ? "matrix-alt" : ""}`}>
                  <button
                    type="button"
                    data-testid={`matrix-col-${m.key}-${a}`}
                    title={`Toggle ${ACTION_LABEL[a]} on ${m.label} for all listed employees`}
                    onClick={() => toggleColumn(m.key, a)}
                    className="matrix-col-btn"
                  >
                    {ACTION_SHORT[a]}
                  </button>
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={PERMISSION_MODULES.length * 3 + 2} className="table-cell text-center py-10">Loading…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={PERMISSION_MODULES.length * 3 + 2} className="table-cell text-center py-10">No employees match.</td></tr>
            )}
            {!loading && visible.map(emp => (
              <tr key={emp.id} className="table-row">
                <td className="table-cell matrix-sticky matrix-name-col">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar url={emp.avatar_url} name={emp.name} size="h-8 w-8" textSize="text-[11px]" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{emp.name}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--text-subtle)' }}>
                        {emp.role === "manager" ? "Manager" : "Employee"}{emp.department ? ` · ${emp.department}` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                {PERMISSION_MODULES.map((m, i) => {
                  const cur = { ...NO_ACCESS, ...(grid[emp.id]?.[m.key] || {}) };
                  const was = { ...NO_ACCESS, ...(original[emp.id]?.[m.key] || {}) };
                  return PERMISSION_ACTIONS.map(a => (
                    <td key={`${m.key}-${a}`} className={`matrix-cell ${a === "view" ? "matrix-group" : ""} ${i % 2 ? "matrix-alt" : ""} ${cur[a] !== was[a] ? "matrix-dirty" : ""}`}>
                      <input
                        type="checkbox"
                        data-testid={`matrix-${emp.id}-${m.key}-${a}`}
                        aria-label={`${emp.name}: ${m.label} ${ACTION_LABEL[a]}`}
                        checked={cur[a]}
                        onChange={() => updateCell(emp.id, m.key, p => toggleAction(p, a))}
                      />
                    </td>
                  ));
                })}
                <td className="matrix-cell">
                  <div className="flex items-center justify-center gap-1">
                    <button type="button" className="matrix-row-btn" data-testid={`matrix-row-all-${emp.id}`} onClick={() => setRow(emp.id, true)}>All</button>
                    <button type="button" className="matrix-row-btn" data-testid={`matrix-row-none-${emp.id}`} onClick={() => setRow(emp.id, false)}>None</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-xs" style={{ color: changedIds.length ? 'var(--badge-amber-text)' : 'var(--text-muted)' }} data-testid="access-matrix-status">
          {changedIds.length
            ? `Unsaved changes for ${changedIds.length} employee${changedIds.length === 1 ? "" : "s"}`
            : `${employees.length} employee${employees.length === 1 ? "" : "s"} · changes apply on their next login or reload`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg h-9"
            disabled={!changedIds.length || saving}
            onClick={() => setGrid(original)}
            data-testid="access-matrix-reset"
          >
            <ArrowCounterClockwise className="h-4 w-4 mr-1.5" /> Discard
          </Button>
          <Button
            size="sm"
            className="rounded-lg h-9 bg-[#0020F8] hover:bg-[#0019C4] text-white"
            disabled={!changedIds.length || saving}
            onClick={handleSave}
            data-testid="access-matrix-save"
          >
            <FloppyDisk className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save Access"}
          </Button>
        </div>
      </div>
    </div>
  );
}
