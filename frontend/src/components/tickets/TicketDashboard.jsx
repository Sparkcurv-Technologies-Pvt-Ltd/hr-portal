import { STATUSES, PRIORITIES } from "./constants";

const Bar = ({ label, value, max, tone }) => (
  <div className="flex items-center gap-3 text-sm">
    <span className="w-36 flex-shrink-0 truncate" style={{ color: "var(--text-secondary)" }}>{label}</span>
    <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--border-color)" }}>
      <div className="h-full rounded-full" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: tone || "var(--brand-primary)", minWidth: value ? 6 : 0 }} />
    </div>
    <span className="w-8 text-right font-bold">{value}</span>
  </div>
);
const TONE_COLOR = { "tone-blue": "#1F3BFF", "tone-amber": "#D97706", "tone-violet": "#7C3AED", "tone-green": "#059669", "tone-teal": "#0D9488", "tone-red": "#E11D48" };

// Counts per status / priority / client, plus overdue and unassigned
export function TicketDashboard({ stats, onFilter }) {
  if (!stats) return null;
  const maxStatus = Math.max(1, ...Object.values(stats.by_status));
  const maxPrio = Math.max(1, ...Object.values(stats.by_priority));
  const maxClient = Math.max(1, ...stats.by_client.map(c => c.open));
  const cards = [
    ["Open tickets", stats.open, "tone-blue", { open_only: true }], ["Overdue (SLA)", stats.overdue, "tone-red", { overdue: true }],
    ["Unassigned", stats.unassigned, "tone-amber", { assignee: "none", open_only: true }], ["Resolved this week", stats.resolved_week, "tone-green", { status: "resolved" }],
  ];
  return (
    <div data-testid="ticket-dashboard">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {cards.map(([label, value, tone, filter]) => (
          <button key={label} onClick={() => onFilter(filter)} className={`stat-card ${tone} text-left`} style={{ display: "block" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{label}</span>
            <p className="text-3xl font-bold mt-2" style={{ color: "var(--tone)" }}>{value}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="section-card p-5 space-y-3"><h3 className="font-bold font-['Outfit']">By status</h3>
          {STATUSES.map(s => <Bar key={s.key} label={s.label} value={stats.by_status[s.key] || 0} max={maxStatus} tone={TONE_COLOR[s.tone]} />)}</div>
        <div className="section-card p-5 space-y-3"><h3 className="font-bold font-['Outfit']">Open by priority</h3>
          {PRIORITIES.map(p => <Bar key={p.key} label={p.label} value={stats.by_priority[p.key] || 0} max={maxPrio} tone={TONE_COLOR[p.tone]} />)}</div>
        <div className="section-card p-5 space-y-3"><h3 className="font-bold font-['Outfit']">Open by client</h3>
          {stats.by_client.length === 0 ? <p className="text-sm" style={{ color: "var(--text-subtle)" }}>No open tickets</p> : stats.by_client.map(c => <Bar key={c.client} label={c.client} value={c.open} max={maxClient} />)}</div>
      </div>
    </div>
  );
}
