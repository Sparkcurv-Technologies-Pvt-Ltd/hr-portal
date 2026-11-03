import { CalendarBlank, ChatCircle } from "@phosphor-icons/react";
import { Avatar } from "@/components/common/Avatar";
import { ISSUE_TYPE, PRIORITY, COLUMNS, isOverdue, shortDate, canTransition } from "./constants";

export function TypeIcon({ type, size = 15 }) {
  const t = ISSUE_TYPE[type] || ISSUE_TYPE.task;
  const Icon = t.icon;
  return <span title={t.label} className="inline-flex items-center justify-center rounded flex-shrink-0" style={{ width: size + 5, height: size + 5, background: t.color }}><Icon style={{ width: size - 3, height: size - 3, color: "#fff" }} weight="bold" /></span>;
}

export function PointsBadge({ points }) {
  if (points == null) return null;
  return <span className="text-[11px] font-bold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }} title="Story points">{points}</span>;
}

export function LabelChips({ labels }) {
  return labels.map(l => <span key={l} className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EEF2FF", color: "#3730A3" }}>{l}</span>);
}

// Draggable issue card for the board
export function IssueCard({ task, workflow, canMove, onOpen, onMove, dragging, onDragStart, onDragEnd }) {
  const p = PRIORITY[task.priority] || PRIORITY.medium;
  return (
    <div role="button" tabIndex={0} draggable={canMove} data-testid={`task-card-${task.id}`}
      onDragStart={e => { e.dataTransfer.setData("text/plain", String(task.id)); e.dataTransfer.effectAllowed = "move"; onDragStart(task); }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)} onKeyDown={e => e.key === "Enter" && onOpen(task)}
      className="rounded-xl p-3 text-left transition-shadow hover:shadow-md"
      style={{ background: "var(--surface)", border: "1px solid var(--border-color)", cursor: canMove ? "grab" : "pointer", opacity: dragging ? 0.45 : 1 }}>
      <p className="text-sm font-semibold break-words" style={{ color: "var(--text-primary)" }}>{task.title}</p>
      {task.labels.length > 0 && <div className="flex flex-wrap gap-1 mt-2"><LabelChips labels={task.labels} /></div>}
      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <TypeIcon type={task.issue_type} />
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-subtle)" }}>{task.key}</span>
          <span className={`chip ${p.tone}`}>{p.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PointsBadge points={task.story_points} />
          {task.assignee_name ? <Avatar url={task.assignee_avatar} name={task.assignee_name} size="h-6 w-6" textSize="text-[9px]" /> : <span className="h-6 w-6 rounded-full border border-dashed" title="Unassigned" />}
        </div>
      </div>
      {(task.due_date || task.comment_count > 0) && (
        <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: "var(--text-subtle)" }}>
          {task.due_date && <span className="flex items-center gap-0.5 font-semibold" style={{ color: isOverdue(task) ? "#E11D48" : undefined }}><CalendarBlank className="h-3.5 w-3.5" />{shortDate(task.due_date)}</span>}
          {task.comment_count > 0 && <span className="flex items-center gap-0.5"><ChatCircle className="h-3.5 w-3.5" />{task.comment_count}</span>}
        </div>
      )}
      {canMove && (
        <select value={task.status} aria-label="Move issue" onClick={e => e.stopPropagation()} onChange={e => onMove(task, e.target.value)}
          className="mt-3 w-full h-8 rounded-lg border px-2 text-xs bg-white sm:hidden">
          {COLUMNS.filter(c => canTransition(workflow, task.status, c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      )}
    </div>
  );
}
