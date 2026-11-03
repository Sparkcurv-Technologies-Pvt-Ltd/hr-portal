import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { ISSUE_TYPES, PRIORITIES, EMPTY_FILTERS } from "./constants";

// Search + assignee / type / priority filters
export function FilterBar({ filters, setFilters, assignees }) {
  const set = (k, v) => setFilters({ ...filters, [k]: v });
  const active = Object.values(filters).some(Boolean);
  const cls = "h-9 rounded-xl border px-2.5 text-sm bg-white min-w-0";
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="issue-filters">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <MagnifyingGlass className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-subtle)" }} />
        <Input value={filters.q} onChange={e => set("q", e.target.value)} placeholder="Search issues" className="h-9 pl-9 rounded-xl" data-testid="issue-search" />
      </div>
      <select className={cls} value={filters.assignee} onChange={e => set("assignee", e.target.value)} aria-label="Assignee" data-testid="filter-assignee">
        <option value="">All assignees</option><option value="none">Unassigned</option>
        {assignees.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
      </select>
      <select className={cls} value={filters.type} onChange={e => set("type", e.target.value)} aria-label="Type" data-testid="filter-type">
        <option value="">All types</option>{ISSUE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <select className={cls} value={filters.priority} onChange={e => set("priority", e.target.value)} aria-label="Priority" data-testid="filter-priority">
        <option value="">All priorities</option>{PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {active && <button onClick={() => setFilters(EMPTY_FILTERS)} className="flex items-center gap-1 text-xs font-semibold h-9 px-2" style={{ color: "var(--brand-primary)" }}><X className="h-3.5 w-3.5" weight="bold" /> Clear</button>}
    </div>
  );
}
