import { format } from "date-fns";

export const STATUSES = [
  { key: "open", label: "Open", tone: "tone-blue" },
  { key: "in_progress", label: "In progress", tone: "tone-amber" },
  { key: "waiting_client", label: "Waiting on client", tone: "tone-violet" },
  { key: "resolved", label: "Resolved", tone: "tone-green" },
  { key: "closed", label: "Closed", tone: "tone-teal" },
];
export const STATUS = Object.fromEntries(STATUSES.map(s => [s.key, s]));

export const PRIORITIES = [
  { key: "low", label: "Low", tone: "tone-teal" },
  { key: "medium", label: "Medium", tone: "tone-blue" },
  { key: "high", label: "High", tone: "tone-amber" },
  { key: "urgent", label: "Urgent", tone: "tone-red" },
];
export const PRIORITY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]));

export const CATEGORIES = [
  { key: "support", label: "Support" }, { key: "bug", label: "Bug" }, { key: "feature", label: "Feature request" },
  { key: "billing", label: "Billing" }, { key: "other", label: "Other" },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

export const selectClass = "w-full h-10 rounded-xl border px-3 text-sm bg-white";
export const when = (iso) => (iso ? format(new Date(iso), "d MMM, h:mm a") : "—");
// <input type="datetime-local"> works in local time; the API stores UTC ISO text
export const toLocalInput = (iso) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "");
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const apiError = (e, fallback) => e.response?.data?.detail || fallback;

export const Pill = ({ item }) => <span className={`chip ${item.tone}`}>{item.label}</span>;
