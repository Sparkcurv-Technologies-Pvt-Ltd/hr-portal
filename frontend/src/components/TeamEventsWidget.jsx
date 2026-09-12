import { useState, useEffect } from "react";
import { Cake, Confetti, UserPlus } from "@phosphor-icons/react";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "";
const getAvatarUrl = (url) => {
  if (!url || url === "") return null;
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
};
const getInitials = (name) => {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
};

function Avatar({ person }) {
  const src = getAvatarUrl(person.avatar_url);
  if (src) return <img src={src} alt={person.name} className="h-8 w-8 rounded-full object-cover flex-shrink-0" />;
  return (
    <div className="h-8 w-8 rounded-full bg-[#002FA7] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
      {getInitials(person.name)}
    </div>
  );
}

function EventColumn({ icon, iconBg, iconColor, title, items, emptyText, renderBadge }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <h3 className="text-sm font-bold text-slate-900 font-['Outfit']">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">
          {items.slice(0, 4).map((p) => (
            <div key={p.id} className="flex items-start gap-2.5">
              <Avatar person={p} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 break-words" data-testid={`event-full-name-${p.id}`}>{p.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{p.department}</p>
              </div>
              <span className="flex-shrink-0 mt-0.5">{renderBadge(p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact 3-column widget for Dashboard/Overview tabs: Birthdays, Work Anniversaries, New Joiners
export function TeamEventsWidget({ api }) {
  const [events, setEvents] = useState({ birthdays: [], anniversaries: [], new_joiners: [] });

  useEffect(() => {
    api.get("/team-events").then(r => setEvents(r.data || {})).catch(() => {});
  }, [api]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6" data-testid="team-events-widget">
      <EventColumn
        icon={<Cake className="h-4 w-4 text-pink-500" weight="duotone" />}
        iconBg="bg-pink-50"
        title="Birthdays"
        items={events.birthdays || []}
        emptyText="No birthdays this month"
        renderBadge={(p) => (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${p.days_until === 0 ? 'bg-pink-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {p.days_until === 0 ? "Today" : p.days_until === 1 ? "Tomorrow" : `${p.days_until}d`}
          </span>
        )}
      />
      <EventColumn
        icon={<Confetti className="h-4 w-4 text-violet-500" weight="duotone" />}
        iconBg="bg-violet-50"
        title="Work Anniversaries"
        items={events.anniversaries || []}
        emptyText="No anniversaries this month"
        renderBadge={(p) => (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${p.days_until === 0 ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {p.years}y{p.days_until === 0 ? " · Today" : ""}
          </span>
        )}
      />
      <EventColumn
        icon={<UserPlus className="h-4 w-4 text-emerald-500" weight="duotone" />}
        iconBg="bg-emerald-50"
        title="Onboarding"
        items={events.new_joiners || []}
        emptyText="No new joiners recently"
        renderBadge={(p) => (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-slate-100 text-slate-500">
            {p.days_since_join === 0 ? "New" : `${p.days_since_join}d ago`}
          </span>
        )}
      />
    </div>
  );
}
