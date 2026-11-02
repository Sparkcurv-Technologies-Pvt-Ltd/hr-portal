import { useState, useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Cake } from "@phosphor-icons/react";
import { Avatar } from "@/components/common/Avatar";

// Shows an "Upcoming Birthdays" list + a month calendar marking weekends (Sat/Sun),
// public holidays and birthdays
export function BirthdayWidget({ api, holidays = [] }) {
  const [birthdays, setBirthdays] = useState([]);
  const [month, setMonth] = useState(new Date());

  useEffect(() => {
    api.get("/birthdays/list").then(r => setBirthdays(r.data || [])).catch(() => setBirthdays([]));
  }, [api]);

  const birthdayDates = birthdays.map(b => {
    const d = new Date(month.getFullYear(), b.month - 1, b.day);
    return d;
  });

  const holidayDates = holidays.map(h => new Date(h.date + "T00:00:00"));

  const upcoming = birthdays.slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div className="p-5 sm:p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-3 mb-5">
          <span className="stat-icon tone-red" style={{ width: 38, height: 38, borderRadius: 12 }}>
            <Cake className="h-5 w-5" weight="duotone" />
          </span>
          <div>
            <h2 className="text-base font-bold font-['Outfit'] leading-tight" style={{ color: 'var(--text-primary)' }}>Upcoming Birthdays</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Who's celebrating next</p>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="stat-icon tone-red mb-3"><Cake className="h-5 w-5" weight="duotone" /></span>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }} data-testid="no-birthdays">No birthdays on record yet</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="birthday-list">
            {upcoming.map((b) => {
              const isToday = b.days_until === 0;
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-3 p-2.5 rounded-xl ${isToday ? 'tone-red' : ''}`}
                  style={isToday ? { background: 'var(--tone-bg)' } : { background: 'var(--surface-elevated)' }}
                >
                  <Avatar url={b.avatar_url} name={b.name} size="h-10 w-10" textSize="text-xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold break-words leading-tight" style={{ color: 'var(--text-primary)' }} data-testid={`birthday-full-name-${b.id}`}>{b.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{b.department}</p>
                  </div>
                  <span
                    className={`chip flex-shrink-0 ${isToday ? '' : 'tone-blue'}`}
                    style={isToday ? { background: 'var(--tone)', color: 'var(--surface)' } : undefined}
                  >
                    {isToday ? "Today! 🎉" : b.days_until === 1 ? "Tomorrow" : `in ${b.days_until}d`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-3 sm:p-4 flex flex-col items-center" style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          modifiers={{ weekend: { dayOfWeek: [0, 6] }, holiday: holidayDates, birthday: birthdayDates }}
          modifiersClassNames={{
            weekend: "text-red-500",
            holiday: "bg-blue-50 text-[#0020F8] font-bold rounded-full",
            birthday: "bg-pink-100 text-pink-700 font-bold rounded-full",
          }}
          data-testid="birthday-calendar"
        />
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 px-3 py-2.5 mt-1 w-full rounded-xl text-[11px] font-medium" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }} data-testid="calendar-legend">
          <span className="flex items-center gap-1.5"><span className="font-bold text-red-500">S</span> Weekend (Sat & Sun)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-50 border border-[#0020F8]/40" /> Public holiday</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-pink-100 border border-pink-300" /> Birthday</span>
        </div>
      </div>
    </div>
  );
}
