import { useState, useEffect } from "react";
import { Calendar } from "./ui/calendar";
import { Cake } from "@phosphor-icons/react";

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

// Shows an "Upcoming Birthdays" list + a month calendar with birthday dates highlighted
export function BirthdayWidget({ api }) {
  const [birthdays, setBirthdays] = useState([]);
  const [month, setMonth] = useState(new Date());

  useEffect(() => {
    api.get("/birthdays/list").then(r => setBirthdays(r.data || [])).catch(() => setBirthdays([]));
  }, [api]);

  const birthdayDates = birthdays.map(b => {
    const d = new Date(month.getFullYear(), b.month - 1, b.day);
    return d;
  });

  const upcoming = birthdays.slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center justify-center w-8 h-8 bg-pink-50 rounded-lg">
            <Cake className="h-4 w-4 text-pink-500" weight="duotone" />
          </div>
          <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Upcoming Birthdays</h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center" data-testid="no-birthdays">No birthdays on record yet</p>
        ) : (
          <div className="space-y-3" data-testid="birthday-list">
            {upcoming.map((b) => {
              const src = getAvatarUrl(b.avatar_url);
              const isToday = b.days_until === 0;
              return (
                <div key={b.id} className={`flex items-start gap-3 p-2.5 rounded-lg ${isToday ? 'bg-pink-50 border border-pink-200' : ''}`}>
                  {src ? (
                    <img src={src} alt={b.name} className="h-9 w-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-[#002FA7] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                      {getInitials(b.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 break-words" data-testid={`birthday-full-name-${b.id}`}>{b.name}</p>
                    <p className="text-xs text-slate-400">{b.department}</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 mt-0.5 ${isToday ? 'bg-pink-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {isToday ? "Today! 🎉" : b.days_until === 1 ? "Tomorrow" : `in ${b.days_until}d`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex justify-center" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          modifiers={{ birthday: birthdayDates }}
          modifiersClassNames={{ birthday: "bg-pink-100 text-pink-700 font-bold rounded-full" }}
          data-testid="birthday-calendar"
        />
      </div>
    </div>
  );
}
