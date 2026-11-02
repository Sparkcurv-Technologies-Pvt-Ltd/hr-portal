import { useState, useEffect } from "react";
import { Cake, Confetti, UserPlus } from "@phosphor-icons/react";
import { Avatar } from "@/components/common/Avatar";

function EventColumn({ icon, tone, title, items, emptyText, renderBadge }) {
  return (
    <div
      className="p-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <span className={`stat-icon ${tone}`} style={{ width: 34, height: 34, borderRadius: 11 }}>
          {icon}
        </span>
        <h3 className="text-sm font-bold font-['Outfit']" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {items.length > 0 && <span className={`chip ${tone} ml-auto`}>{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-xs py-4 text-center rounded-xl" style={{ color: 'var(--text-subtle)', background: 'var(--surface-elevated)' }}>{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 4).map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <Avatar url={p.avatar_url} name={p.name} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold break-words leading-tight" style={{ color: 'var(--text-primary)' }} data-testid={`event-full-name-${p.id}`}>{p.name}</p>
                <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{p.department}</p>
              </div>
              <span className="flex-shrink-0">{renderBadge(p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const badgeCls = (highlight, tone) => `chip ${highlight ? tone : ""} text-[10.5px]`;

// Compact 3-column widget for Dashboard/Overview tabs: Birthdays, Work Anniversaries, New Joiners
export function TeamEventsWidget({ api }) {
  const [events, setEvents] = useState({ birthdays: [], anniversaries: [], new_joiners: [] });

  useEffect(() => {
    api.get("/team-events").then(r => setEvents(r.data || {})).catch(() => {});
  }, [api]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5 mb-6" data-testid="team-events-widget">
      <EventColumn
        icon={<Cake className="h-[18px] w-[18px]" weight="duotone" />}
        tone="tone-red"
        title="Birthdays"
        items={events.birthdays || []}
        emptyText="No birthdays this month"
        renderBadge={(p) => (
          <span className={badgeCls(p.days_until === 0, "tone-red")}>
            {p.days_until === 0 ? "Today" : p.days_until === 1 ? "Tomorrow" : `${p.days_until}d`}
          </span>
        )}
      />
      <EventColumn
        icon={<Confetti className="h-[18px] w-[18px]" weight="duotone" />}
        tone="tone-violet"
        title="Work Anniversaries"
        items={events.anniversaries || []}
        emptyText="No anniversaries this month"
        renderBadge={(p) => (
          <span className={badgeCls(p.days_until === 0, "tone-violet")}>
            {p.years}y{p.days_until === 0 ? " · Today" : ""}
          </span>
        )}
      />
      <EventColumn
        icon={<UserPlus className="h-[18px] w-[18px]" weight="duotone" />}
        tone="tone-green"
        title="Onboarding"
        items={events.new_joiners || []}
        emptyText="No new joiners recently"
        renderBadge={(p) => (
          <span className={badgeCls(p.days_since_join === 0, "tone-green")}>
            {p.days_since_join === 0 ? "New" : `${p.days_since_join}d ago`}
          </span>
        )}
      />
    </div>
  );
}
