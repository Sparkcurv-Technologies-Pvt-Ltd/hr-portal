import { format } from "date-fns";
import { CalendarStar } from "@phosphor-icons/react";
import { BirthdayWidget } from "@/components/common/BirthdayWidget";
import { TabHeader, SectionHeader, EmptyState } from "@/components/employee/EmployeeUi";

export function HolidaysTab({ api, holidays }) {
  const today = new Date(new Date().toDateString());
  const upcomingCount = holidays.filter((h) => new Date(h.date + "T00:00:00") >= today).length;

  return (
    <>
      <TabHeader title="Calendar & Holidays" description="Public holidays, weekly offs and team birthdays" />

      <BirthdayWidget api={api} holidays={holidays} />

      {/* Weekend Info */}
      <div className="tone-blue flex items-center gap-3 rounded-2xl px-4 py-3 mb-6" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
        <CalendarStar className="h-5 w-5 flex-shrink-0" weight="duotone" />
        <p className="text-sm font-semibold">
          Every Saturday & Sunday is a weekly holiday
        </p>
      </div>

      {/* Holidays Table */}
      <div className="section-card">
        <SectionHeader icon={CalendarStar} tone="blue" title="Public holidays" sub={`${upcomingCount} upcoming`}>
          <span className="chip">Total public holidays: <strong style={{ color: 'var(--text-primary)' }}>{holidays.length}</strong></span>
        </SectionHeader>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">#</th>
              <th className="table-header">Date</th>
              <th className="table-header">Day</th>
              <th className="table-header">Festival</th>
            </tr>
          </thead>
          <tbody>
            {holidays.length === 0 ? (
              <tr><td colSpan={4}><EmptyState inTable compact icon={CalendarStar} tone="blue" title="No public holidays added yet" /></td></tr>
            ) : holidays.map((holiday, index) => {
              const holidayDate = new Date(holiday.date + "T00:00:00");
              const isPast = holidayDate < today;
              return (
                <tr key={index} className={`table-row ${isPast ? "opacity-50" : ""}`}>
                  <td className="table-cell text-slate-400 tabular-nums">{index + 1}</td>
                  <td className="table-cell font-semibold text-slate-900 whitespace-nowrap">
                    {format(holidayDate, "dd MMM yyyy")}
                  </td>
                  <td className="table-cell">{holiday.day}</td>
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isPast ? 'var(--text-subtle)' : 'var(--brand-primary)' }}></span>
                      {holiday.festival}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
