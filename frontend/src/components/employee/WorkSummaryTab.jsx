import { Clock, CalendarCheck, Hourglass, Warning, PauseCircle, Scroll } from "@phosphor-icons/react";
import { TabHeader, StatCard, SectionHeader } from "@/components/employee/EmployeeUi";
import { formatHours } from "@/lib/format";

export function WorkSummaryTab({ workingSummary }) {
  const policyGroups = [
    {
      title: "Daily Requirements", icon: Clock, tone: "blue",
      items: [
        <>Working day: <strong>{workingSummary.total_hours_per_day} hours</strong> Login → Logout</>,
        <>Paused time (travel / away) is not counted</>,
        <>Less than {workingSummary.required_hours_per_day}h = <strong>Short Day</strong></>,
      ],
    },
    {
      title: "Short Day Policy", icon: Warning, tone: "red",
      items: [
        <>{workingSummary.short_days_for_half_leave} short days in a month = <strong>0.5 day leave deduction</strong></>,
        <>Deducted automatically from casual leave</>,
      ],
    },
    {
      title: "Permission Hours", icon: Hourglass, tone: "amber",
      items: [
        <>Monthly allowance: <strong>2 hours</strong></>,
        <>Max per use: <strong>1 hour</strong> (use twice per month)</>,
      ],
    },
    {
      title: "Pause (travel / away)", icon: PauseCircle, tone: "teal",
      items: [
        <>Use <strong>Pause</strong> when you're travelling or away from work</>,
        <>Paused time doesn't count toward the 8 hours — resume before you log out</>,
      ],
    },
  ];

  return (
    <>
      <TabHeader title="Work Summary" description="Your monthly working hours overview" />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={CalendarCheck} tone="blue" label="Working Days" value={workingSummary.total_working_days} sub="this month" />
        <StatCard icon={Clock} tone="green" label="Total Hours" value={formatHours(workingSummary.total_working_hours)} sub={`avg ${workingSummary.average_hours_per_day}h/day`} />
        <StatCard icon={Warning} tone="red" label="Short Days" value={workingSummary.short_days_count} sub="logged out before 8h" />
        <StatCard icon={Hourglass} tone="amber" label="Half Days Deducted" value={workingSummary.half_days_deducted} sub="from casual leave" />
      </div>

      {/* Policy Info */}
      <div className="section-card">
        <SectionHeader icon={Scroll} tone="violet" title="Working Hours Policy" sub="How your hours, pauses and permissions are counted" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 sm:p-6">
          {policyGroups.map(({ title, icon: Icon, tone, items }) => (
            <div key={title} className={`rounded-2xl p-4 tone-${tone}`} style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
                  <Icon className="h-4 w-4" weight="duotone" />
                </span>
                <h3 className="font-semibold text-sm text-slate-900">{title}</h3>
              </div>
              <ul className="space-y-2 text-sm text-slate-600">
                {items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full mt-[7px] flex-shrink-0" style={{ background: 'var(--tone)' }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
