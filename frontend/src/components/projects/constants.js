import { format } from "date-fns";
import { Bug, BookmarkSimple, Lightning, CheckSquare } from "@phosphor-icons/react";

export const COLUMNS = [
  { key: "todo", label: "To Do", tone: "tone-blue" },
  { key: "in_progress", label: "In Progress", tone: "tone-amber" },
  { key: "review", label: "Review", tone: "tone-violet" },
  { key: "done", label: "Done", tone: "tone-green" },
];
export const STATUS_LABEL = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));

export const PRIORITIES = [
  { key: "low", label: "Low", tone: "tone-teal" },
  { key: "medium", label: "Medium", tone: "tone-blue" },
  { key: "high", label: "High", tone: "tone-amber" },
  { key: "urgent", label: "Urgent", tone: "tone-red" },
];
export const PRIORITY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]));

export const ISSUE_TYPES = [
  { key: "task", label: "Task", icon: CheckSquare, color: "#1F3BFF" },
  { key: "bug", label: "Bug", icon: Bug, color: "#E11D48" },
  { key: "story", label: "Story", icon: BookmarkSimple, color: "#059669" },
  { key: "epic", label: "Epic", icon: Lightning, color: "#7C3AED" },
];
export const ISSUE_TYPE = Object.fromEntries(ISSUE_TYPES.map(t => [t.key, t]));

export const selectClass = "w-full h-10 rounded-xl border px-3 text-sm bg-white";

export const todayStr = () => format(new Date(), "yyyy-MM-dd");
export const isOverdue = (task) => task.status !== "done" && !!task.due_date && task.due_date < todayStr();
export const shortDate = (d) => (d ? format(new Date(d + "T00:00:00"), "d MMM") : "");
export const canMoveIssue = (user, isLead, task) => isLead || String(task.assignee_id) === String(user.id);

// Search + assignee/type/priority filters shared by the board and the backlog
export const EMPTY_FILTERS = { q: "", assignee: "", type: "", priority: "" };
export function applyFilters(tasks, f) {
  const q = f.q.trim().toLowerCase();
  return tasks.filter(t =>
    (!q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || t.labels.some(l => l.includes(q))) &&
    (!f.assignee || (f.assignee === "none" ? !t.assignee_id : String(t.assignee_id) === f.assignee)) &&
    (!f.type || t.issue_type === f.type) &&
    (!f.priority || t.priority === f.priority)
  );
}

// Workflow: `transitions` maps a status to the statuses it may move to (served by the API, enforced there too)
export const nextStatuses = (workflow, status) => workflow?.transitions?.[status] || [];
export const canTransition = (workflow, from, to) => from === to || !workflow || nextStatuses(workflow, from).includes(to);
export const transitionError = (workflow, from, to, labels) => {
  const opts = nextStatuses(workflow, from).map(k => labels[k] || k).join(", ") || "nothing";
  return `Can't move from ${labels[from] || from} to ${labels[to] || to}. From ${labels[from] || from} you can move to: ${opts}.`;
};
