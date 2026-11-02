import { useMemo } from "react";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer
} from "recharts";
import { ChartBar } from "@phosphor-icons/react";
import { formatHours } from "@/lib/format";

const TARGET_HOURS = 8;
const MAX_DAYS = 14;

// Chart colours (SVG attributes can't read CSS vars reliably, so they're set in JS).
// Single series -> one hue: the brand blue step that passes contrast on the white surface.
const PALETTE = {
  light: { bar: "#1F3BFF", barHover: "#0020F8", grid: "#EEF1F6", axis: "#64748B", target: "#334155", cursor: "rgba(47, 91, 224, 0.08)" },
};

const parseDay = (d) => (typeof d === "string" && d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d));

function HoursTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)' }}
    >
      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatHours(p.hours)}</p>
      <p style={{ color: 'var(--text-muted)' }}>{p.full}</p>
      <p className="mt-0.5 font-semibold" style={{ color: p.hours >= TARGET_HOURS ? 'var(--status-success)' : 'var(--status-error)' }}>
        {p.hours >= TARGET_HOURS ? "Met 8h target" : `${formatHours(TARGET_HOURS - p.hours)} short of 8h`}
      </p>
    </div>
  );
}

// "Hours logged" column chart for the most recent completed attendance days, with an 8h target line
export function HoursChart({ attendanceHistory = [] }) {
  const c = PALETTE.light;

  const data = useMemo(() => attendanceHistory
    .filter((r) => r.working_hours !== null && r.working_hours !== undefined && r.clock_out)
    .slice(0, MAX_DAYS)
    .reverse()
    .map((r) => {
      const d = parseDay(r.date);
      return {
        key: String(r.date),
        label: format(d, "d MMM"),
        full: format(d, "EEE, d MMM yyyy"),
        hours: Math.round(Number(r.working_hours) * 100) / 100,
      };
    }), [attendanceHistory]);

  const avg = data.length ? data.reduce((s, x) => s + x.hours, 0) / data.length : 0;
  const met = data.filter((x) => x.hours >= TARGET_HOURS).length;
  const yMax = Math.max(10, Math.ceil(Math.max(0, ...data.map((x) => x.hours)) / 2) * 2);
  const ticks = Array.from({ length: yMax / 2 + 1 }, (_, i) => i * 2);

  return (
    <div className="chart-card" data-testid="hours-chart">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="chart-title">Hours logged</p>
          <p className="chart-sub">
            {data.length ? `Last ${data.length} completed day${data.length === 1 ? "" : "s"} · target ${TARGET_HOURS}h` : `Daily working hours · target ${TARGET_HOURS}h`}
          </p>
        </div>
        {data.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              <span className="inline-block w-4 h-0.5 rounded" style={{ background: c.target }} /> {TARGET_HOURS}h target
            </span>
            <span className="chip">Avg <strong style={{ color: 'var(--text-primary)' }}>{formatHours(avg)}</strong></span>
            <span className="chip">{met}/{data.length} days ≥ {TARGET_HOURS}h</span>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center h-[200px]">
          <span className="stat-icon tone-blue mb-3"><ChartBar className="h-5 w-5" weight="duotone" /></span>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>No completed days yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Your daily hours will appear here after your first logout.</p>
        </div>
      ) : (
        <div className="h-[220px] -ml-2" role="img" aria-label={`Hours logged per day for the last ${data.length} days, average ${formatHours(avg)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: c.grid }}
                tick={{ fill: c.axis, fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={10}
                tickMargin={8}
              />
              <YAxis
                ticks={ticks}
                domain={[0, yMax]}
                tickLine={false}
                axisLine={false}
                width={34}
                tick={{ fill: c.axis, fontSize: 11 }}
                tickFormatter={(v) => `${v}h`}
              />
              <Tooltip content={<HoursTooltip />} cursor={{ fill: c.cursor, radius: 6 }} />
              <Bar
                dataKey="hours"
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                fill={c.bar}
                activeBar={{ fill: c.barHover }}
                animationDuration={500}
              />
              <ReferenceLine
                y={TARGET_HOURS}
                stroke={c.target}
                strokeWidth={1.25}
                ifOverflow="extendDomain"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
