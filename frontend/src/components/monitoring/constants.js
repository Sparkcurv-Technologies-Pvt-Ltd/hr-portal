import { formatDistanceToNowStrict } from "date-fns";

export const STATUS = {
  up: { label: "Up", tone: "tone-green", color: "#059669" },
  down: { label: "Down", tone: "tone-red", color: "#E11D48" },
  degraded: { label: "Degraded", tone: "tone-amber", color: "#D97706" },
  unknown: { label: "Waiting", tone: "tone-violet", color: "#7C3AED" },
  paused: { label: "Paused", tone: "tone-teal", color: "#0D9488" },
};
export const TYPES = [
  { key: "http", label: "Website / URL" },
  { key: "tcp", label: "Port (TCP)" },
  { key: "agent", label: "Server agent (CPU / RAM / disk)" },
];
export const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.key, t.label]));
export const INTERVALS = [[60, "1 minute"], [300, "5 minutes"], [600, "10 minutes"], [900, "15 minutes"], [1800, "30 minutes"], [3600, "1 hour"]];
export const selectClass = "w-full h-10 rounded-xl border px-3 text-sm bg-white";
export const ago = (iso) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "never");
export const apiError = (e, fallback) => e.response?.data?.detail || fallback;
export const pct = (v) => (v == null ? "—" : `${v}%`);
export const describeTarget = (m) => (m.type === "agent" ? "Reports from the server" : m.type === "tcp" ? `${m.target}:${m.port}` : m.target);

export const StatusPill = ({ status }) => { const s = STATUS[status] || STATUS.unknown; return <span className={`chip ${s.tone}`}>{s.label}</span>; };
