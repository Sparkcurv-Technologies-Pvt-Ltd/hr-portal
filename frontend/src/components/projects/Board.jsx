import { useState } from "react";
import { toast } from "sonner";
import { COLUMNS, STATUS_LABEL, canMoveIssue, canTransition, transitionError } from "./constants";
import { IssueCard } from "./IssueBits";

// Four-column kanban board. Drag a card to another column to change its status (desktop);
// on phones each card has a dropdown instead.
export function Board({ tasks, user, isLead, workflow, onOpen, onMove }) {
  const [dragged, setDragged] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const drop = (status) => {
    if (dragged && dragged.status !== status) {
      if (canTransition(workflow, dragged.status, status)) onMove(dragged, status);
      else toast.error(transitionError(workflow, dragged.status, status, STATUS_LABEL));
    }
    setDragged(null); setOverCol(null);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map(col => {
        const items = tasks.filter(t => t.status === col.key);
        const points = items.reduce((n, t) => n + (t.story_points || 0), 0);
        const allowed = !dragged || canTransition(workflow, dragged.status, col.key);   // while dragging, columns the issue can't move to are dimmed
        const active = overCol === col.key && dragged && dragged.status !== col.key && allowed;
        return (
          <div key={col.key} data-testid={`column-${col.key}`}
            onDragOver={e => { if (dragged) { e.preventDefault(); setOverCol(col.key); } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null); }}
            onDrop={e => { e.preventDefault(); drop(col.key); }}
            className="rounded-2xl p-3 min-w-0 transition-colors"
            style={{ background: active ? "#EAF0FF" : "var(--surface-elevated)", border: `1px solid ${active ? "var(--brand-primary)" : "var(--border-color)"}`, opacity: allowed ? 1 : 0.45 }}>
            <div className="flex items-center justify-between px-1 mb-3">
              <span className={`chip ${col.tone}`}>{col.label}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--text-subtle)" }}>{items.length}{points ? ` · ${points} pts` : ""}</span>
            </div>
            <div className="space-y-3 min-h-[60px]">
              {items.length === 0 && <p className="text-xs text-center py-6" style={{ color: "var(--text-subtle)" }}>{active ? "Drop here" : "No issues"}</p>}
              {items.map(t => (
                <IssueCard key={t.id} task={t} workflow={workflow} canMove={canMoveIssue(user, isLead, t)} onOpen={onOpen} onMove={onMove}
                  dragging={dragged?.id === t.id} onDragStart={setDragged} onDragEnd={() => { setDragged(null); setOverCol(null); }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
