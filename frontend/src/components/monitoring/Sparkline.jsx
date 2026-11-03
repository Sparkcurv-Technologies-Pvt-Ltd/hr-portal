// Tiny inline chart of recent values (no chart library). Gaps (null) are skipped; `max` fixes the top of the scale.
export function Sparkline({ values, max, color = "#1F3BFF", height = 44, label }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Not enough data yet</p>;
  const top = max ?? Math.max(...pts.map(([, v]) => v), 1);
  const w = 300, n = values.length - 1;
  const path = pts.map(([i, v]) => `${((i / n) * w).toFixed(1)},${(height - 2 - (Math.min(v, top) / top) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
