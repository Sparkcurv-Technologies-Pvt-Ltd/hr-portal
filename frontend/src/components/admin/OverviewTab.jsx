import { useMemo } from "react";
import { format } from "date-fns";
import {
  Users, UserCheck, UserMinus, CalendarCheck, CalendarBlank, ChartBar, TrendUp, Buildings,
} from "@phosphor-icons/react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { TeamEventsWidget } from "@/components/common/TeamEventsWidget";

// Attendance states. These are status colours (good / warning / serious / critical):
// fixed colours, always shown with a text label (legend / tooltip).
const ATTENDANCE_STATES = [
  { key: "ontime", label: "On time", color: "#0CA30C" },
  { key: "late", label: "Late (after 10 AM)", short: "Late", color: "#FAB219" },
  { key: "short", label: "Short day", color: "#EC835A" },
  { key: "absent", label: "Absent", color: "#D03B3B" },
];
const HEAT_CELL = {
  ontime: "#0CA30C",
  present: "#0CA30C",
  late: "#FAB219",
  short: "#EC835A",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const isPresent = (s) => s && s !== "absent";

// Chart chrome reads the design tokens (text / border / surface CSS variables).
const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11, fontFamily: "Manrope, sans-serif" };
const GRID_STROKE = "var(--border-color)";

function ChartTooltip({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-xs min-w-[150px]"
      style={{ background: "var(--surface)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-md)", color: "var(--text-secondary)" }}
    >
      {render(payload, label)}
    </div>
  );
}

function TooltipRow({ color, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5">
        {color && <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />}
        {label}
      </span>
      <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function ChartEmpty({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full min-h-[200px] gap-3">
      <span className="stat-icon tone-blue"><Icon className="h-5 w-5" weight="duotone" /></span>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>{text}</p>
    </div>
  );
}

function ChartHeader({ title, sub, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="chart-title">{title}</h2>
        {sub && <p className="chart-sub">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function OverviewTab({ analytics, api, heatmapData }) {
  const employees = useMemo(() => heatmapData?.employees || [], [heatmapData]);
  const dates = useMemo(() => heatmapData?.dates || [], [heatmapData]);

  // Daily share of the team that clocked in (last 4 weeks, Mon–Fri)
  const trend = useMemo(() => {
    if (!employees.length) return [];
    return dates.map((d, i) => {
      const present = employees.filter(e => isPresent(e.days[i]?.status)).length;
      return {
        date: d,
        label: format(new Date(d + "T00:00:00"), "MMM d"),
        present,
        total: employees.length,
        rate: Math.round((present / employees.length) * 100),
      };
    });
  }, [employees, dates]);

  // On-time / late / short / absent mix per weekday, as a share of all employee-days
  const weekdayMix = useMemo(() => {
    if (!employees.length) return [];
    const rows = WEEKDAYS.map(day => ({ day, ontime: 0, late: 0, short: 0, absent: 0, n: 0 }));
    dates.forEach((d, i) => {
      const wd = new Date(d + "T00:00:00").getDay(); // 1..5
      const row = rows[wd - 1];
      if (!row) return;
      employees.forEach(e => {
        const s = e.days[i]?.status;
        const key = s === "present" ? "ontime" : s;
        if (row[key] === undefined) return;
        row[key] += 1;
        row.n += 1;
      });
    });
    return rows.map(r => {
      const pct = (v) => (r.n ? Math.round((v / r.n) * 1000) / 10 : 0);
      return { ...r, ontimePct: pct(r.ontime), latePct: pct(r.late), shortPct: pct(r.short), absentPct: pct(r.absent) };
    });
  }, [employees, dates]);

  const departments = useMemo(
    () => (analytics.department_breakdown || [])
      .map(d => ({ name: d.department || "General", count: d.count }))
      .sort((a, b) => b.count - a.count),
    [analytics.department_breakdown]
  );

  const presentPct = analytics.total_employees ? Math.round((analytics.present_today / analytics.total_employees) * 100) : 0;
  const avgRate = trend.length ? Math.round(trend.reduce((s, t) => s + t.rate, 0) / trend.length) : null;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const stats = [
    { label: "Total Employees", value: analytics.total_employees, sub: `${departments.length} department${departments.length === 1 ? "" : "s"}`, icon: Users, tone: "tone-blue" },
    { label: "Present Today", value: analytics.present_today, sub: `${presentPct}% of the team`, icon: UserCheck, tone: "tone-green" },
    { label: "Absent Today", value: analytics.absent_today, sub: "Not clocked in yet", icon: UserMinus, tone: "tone-red" },
    { label: "Pending Leaves", value: analytics.pending_leaves, sub: analytics.pending_leaves ? "Awaiting review" : "All caught up", icon: CalendarCheck, tone: "tone-amber" },
  ];

  return (
    <>
      {/* Hero */}
      <div className="hero-banner mb-6" data-testid="overview-hero">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="hero-sub text-sm font-medium flex items-center gap-1.5">
              <CalendarBlank className="h-4 w-4" weight="bold" />
              {format(new Date(), "EEEE, MMMM d, yyyy")}
            </p>
            <h1 className="font-bold font-['Outfit'] tracking-tight mt-1.5">{greeting} — here's your team today</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="hero-chip"><UserCheck className="h-3.5 w-3.5" weight="bold" /> {analytics.present_today} of {analytics.total_employees} present</span>
          <span className="hero-chip"><CalendarCheck className="h-3.5 w-3.5" weight="bold" /> {analytics.pending_leaves} pending leave{analytics.pending_leaves === 1 ? "" : "s"}</span>
          {avgRate !== null && (
            <span className="hero-chip"><TrendUp className="h-3.5 w-3.5" weight="bold" /> {avgRate}% avg attendance · 4 wks</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 mb-6">
        {stats.map(({ label, value, sub, icon: Icon, tone }) => (
          <div key={label} className="stat-card">
            <div className="stat-top">
              <span className="stat-label">{label}</span>
              <span className={`stat-icon ${tone}`}><Icon className="h-5 w-5" weight="duotone" /></span>
            </div>
            <div>
              <p className="stat-value">{value ?? 0}</p>
              <p className="stat-sub mt-1">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row: attendance trend + department breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
        <div className="chart-card xl:col-span-2 min-w-0" data-testid="attendance-trend-chart">
          <ChartHeader title="Attendance trend" sub="Share of the team that clocked in each working day · last 4 weeks">
            {avgRate !== null && <span className="chip tone-blue">Avg {avgRate}%</span>}
          </ChartHeader>
          {trend.length ? (
            <div className="h-[240px] -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="overviewTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} minTickGap={24} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    cursor={{ stroke: "var(--text-subtle)", strokeWidth: 1 }}
                    content={(p) => (
                      <ChartTooltip {...p} render={(payload) => {
                        const r = payload[0].payload;
                        return (
                          <>
                            <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{format(new Date(r.date + "T00:00:00"), "EEE, MMM d")}</p>
                            <TooltipRow color="var(--brand-primary)" label="Attendance" value={`${r.rate}%`} />
                            <TooltipRow label="Clocked in" value={`${r.present} / ${r.total}`} />
                          </>
                        );
                      }} />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="var(--brand-primary)"
                    strokeWidth={2}
                    fill="url(#overviewTrendFill)"
                    dot={false}
                    activeDot={{ r: 5, fill: "var(--brand-primary)", stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmpty icon={TrendUp} text="No attendance recorded in the last 4 weeks" />
          )}
        </div>

        <div className="chart-card min-w-0" data-testid="department-chart">
          <ChartHeader title="Department breakdown" sub="Headcount by department" />
          {departments.length ? (
            <div style={{ height: Math.max(96, departments.length * 44 + 8) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departments} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={10}>
                  <XAxis type="number" hide allowDecimals={false} domain={[0, "dataMax"]} />
                  <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: "var(--text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip
                    cursor={{ fill: "var(--table-row-hover)" }}
                    content={(p) => (
                      <ChartTooltip {...p} render={(payload) => (
                        <>
                          <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{payload[0].payload.name}</p>
                          <TooltipRow color="var(--brand-primary)" label="Employees" value={payload[0].value} />
                        </>
                      )} />
                    )}
                  />
                  <Bar dataKey="count" fill="var(--brand-primary)" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false}>
                    <LabelList dataKey="count" position="right" offset={8} style={{ fill: "var(--text-primary)", fontSize: 12, fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmpty icon={Buildings} text="No departments yet" />
          )}
        </div>
      </div>

      <TeamEventsWidget api={api} />

      {/* Weekday pattern + heatmap */}
      {employees.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="chart-card min-w-0" data-testid="weekday-attendance-chart">
            <ChartHeader title="Attendance by weekday" sub="Mix of on-time, late, short and absent days · last 4 weeks" />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
              {ATTENDANCE_STATES.map(s => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.short || s.label}
                </span>
              ))}
            </div>
            <div className="h-[240px] -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdayMix} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    cursor={{ fill: "var(--table-row-hover)" }}
                    content={(p) => (
                      <ChartTooltip {...p} render={(payload, label) => {
                        const r = payload[0].payload;
                        return (
                          <>
                            <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{label} · {r.n} employee-days</p>
                            {[...ATTENDANCE_STATES].reverse().map(s => (
                              <TooltipRow key={s.key} color={s.color} label={s.short || s.label} value={`${r[s.key]} · ${r[`${s.key}Pct`]}%`} />
                            ))}
                          </>
                        );
                      }} />
                    )}
                  />
                  {ATTENDANCE_STATES.map((s, i) => (
                    <Bar
                      key={s.key}
                      dataKey={`${s.key}Pct`}
                      name={s.label}
                      stackId="mix"
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={2}
                      barSize={26}
                      radius={i === ATTENDANCE_STATES.length - 1 ? [4, 4, 0, 0] : 0}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card xl:col-span-2 min-w-0" data-testid="attendance-heatmap">
            <ChartHeader title="Attendance heatmap" sub="Each employee, each working day · last 4 weeks">
              <span className="chip"><ChartBar className="h-3.5 w-3.5" weight="bold" /> {employees.length} employee{employees.length === 1 ? "" : "s"}</span>
            </ChartHeader>
            <div>
              <table className="w-full text-xs" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th className="text-left pr-3 py-1.5 font-semibold sticky left-0 z-[1] min-w-[130px]" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>Employee</th>
                    {dates.map(d => {
                      const dt = new Date(d + "T00:00:00");
                      return (
                        <th key={d} className="text-center px-[1px] py-1.5 font-medium" style={{ minWidth: 26, color: "var(--text-subtle)" }}>
                          <div>{["S", "M", "T", "W", "T", "F", "S"][dt.getDay()]}</div>
                          <div className="text-[10px] tabular-nums">{dt.getDate()}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.employee_id}>
                      <td className="pr-3 py-[3px] font-semibold sticky left-0 z-[1] truncate max-w-[130px]" style={{ background: "var(--surface)", color: "var(--text-secondary)" }} title={emp.name}>
                        {emp.name}
                      </td>
                      {emp.days.map(day => (
                        <td key={day.date} className="text-center px-[1px] py-[3px]">
                          <div
                            title={`${day.date}: ${day.status}${day.hours ? ` (${day.hours}h)` : ""}`}
                            className="w-[22px] h-[22px] rounded-[5px] mx-auto"
                            style={HEAT_CELL[day.status]
                              ? { background: HEAT_CELL[day.status] }
                              : { background: "color-mix(in srgb, #D03B3B 20%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, #D03B3B 34%, transparent)" }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
              {ATTENDANCE_STATES.map(s => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-[4px]"
                    style={s.key === "absent"
                      ? { background: "color-mix(in srgb, #D03B3B 20%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, #D03B3B 34%, transparent)" }
                      : { background: s.color }}
                  />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
