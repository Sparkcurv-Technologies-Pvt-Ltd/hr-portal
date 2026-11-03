import { useState } from "react";
import { CaretDown, CaretRight, Plus, Play, CheckCircle, PencilSimple, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/common/Avatar";
import { COLUMNS, PRIORITY, STATUS_LABEL, canMoveIssue, canTransition, shortDate } from "./constants";
import { TypeIcon, PointsBadge, LabelChips } from "./IssueBits";

function IssueRow({ task, user, isLead, workflow, onOpen, onMove, setDragged }) {
  const p = PRIORITY[task.priority] || PRIORITY.medium;
  return (
    <div role="button" tabIndex={0} draggable={isLead} data-testid={`backlog-row-${task.id}`}
      onDragStart={e => { e.dataTransfer.setData("text/plain", String(task.id)); e.dataTransfer.effectAllowed = "move"; setDragged(task); }}
      onDragEnd={() => setDragged(null)}
      onClick={() => onOpen(task)} onKeyDown={e => e.key === "Enter" && onOpen(task)}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm hover:bg-slate-50"
      style={{ borderTop: "1px solid var(--border-color)", cursor: isLead ? "grab" : "pointer" }}>
      <TypeIcon type={task.issue_type} />
      <span className="text-xs font-semibold flex-shrink-0" style={{ color: "var(--text-subtle)" }}>{task.key}</span>
      <span className="font-medium flex-1 min-w-[140px] break-words" style={{ color: task.status === "done" ? "var(--text-subtle)" : "var(--text-primary)", textDecoration: task.status === "done" ? "line-through" : "none" }}>{task.title}</span>
      <div className="flex flex-wrap gap-1"><LabelChips labels={task.labels} /></div>
      <span className={`chip ${p.tone}`}>{p.label}</span>
      {canMoveIssue(user, isLead, task) ? (
        <select value={task.status} aria-label="Status" onClick={e => e.stopPropagation()} onChange={e => onMove(task, e.target.value)} className="h-7 rounded-lg border px-1.5 text-xs bg-white">
          {COLUMNS.filter(c => canTransition(workflow, task.status, c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      ) : <span className="text-xs" style={{ color: "var(--text-muted)" }}>{STATUS_LABEL[task.status]}</span>}
      <PointsBadge points={task.story_points} />
      {task.assignee_name ? <Avatar url={task.assignee_avatar} name={task.assignee_name} size="h-6 w-6" textSize="text-[9px]" /> : <span className="h-6 w-6 rounded-full border border-dashed flex-shrink-0" title="Unassigned" />}
    </div>
  );
}

function Section({ title, subtitle, meta, tone, actions, children, count, onDropIssue, dragged, defaultOpen = true, testId }) {
  const [open, setOpen] = useState(defaultOpen);
  const [over, setOver] = useState(false);
  return (
    <div className="rounded-2xl overflow-hidden mb-4" data-testid={testId}
      onDragOver={e => { if (dragged && onDropIssue) { e.preventDefault(); setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); if (dragged && onDropIssue) onDropIssue(dragged); }}
      style={{ background: "var(--surface)", border: `1px solid ${over ? "var(--brand-primary)" : "var(--border-color)"}`, boxShadow: over ? "0 0 0 3px #EAF0FF" : undefined }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3" style={{ background: "var(--surface-elevated)" }}>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 min-w-0 text-left" aria-label="Toggle section">
          {open ? <CaretDown className="h-4 w-4 flex-shrink-0" weight="bold" /> : <CaretRight className="h-4 w-4 flex-shrink-0" weight="bold" />}
          <span className="font-bold font-['Outfit'] truncate">{title}</span>
        </button>
        {tone && <span className={`chip ${tone}`}>{meta}</span>}
        {subtitle && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{subtitle}</span>}
        <span className="text-xs font-semibold" style={{ color: "var(--text-subtle)" }}>{count}</span>
        <div className="flex items-center gap-2 ml-auto">{actions}</div>
      </div>
      {open && children}
    </div>
  );
}

// Backlog planning: each open sprint plus the unscheduled backlog. Admins/managers drag issues between
// sections (or use the issue dialog) and start / complete / edit / delete sprints.
export function Backlog({ tasks, sprints, user, isLead, canDelete, workflow, onOpen, onMove, onMoveToSprint, onNewIssue, onNewSprint, onEditSprint, onStartSprint, onCompleteSprint, onDeleteSprint }) {
  const [dragged, setDragged] = useState(null);
  const open = sprints.filter(s => s.status !== "completed");
  const completed = sprints.filter(s => s.status === "completed");
  const rows = (list) => list.length === 0
    ? <p className="text-xs text-center py-6" style={{ color: "var(--text-subtle)" }}>{isLead ? "Drag issues here" : "No issues"}</p>
    : list.map(t => <IssueRow key={t.id} task={t} user={user} isLead={isLead} workflow={workflow} onOpen={onOpen} onMove={onMove} setDragged={setDragged} />);
  const drop = (sprintId) => (t) => { setDragged(null); if (t.sprint_id !== sprintId) onMoveToSprint(t, sprintId); };
  const backlog = tasks.filter(t => !t.sprint_id);

  return (
    <>
      {open.map(s => {
        const list = tasks.filter(t => t.sprint_id === s.id);
        return (
          <Section key={s.id} testId={`sprint-${s.id}`} title={s.name} tone={s.status === "active" ? "tone-green" : "tone-blue"} meta={s.status === "active" ? "Active" : "Planned"}
            subtitle={[s.start_date && s.end_date ? `${shortDate(s.start_date)} – ${shortDate(s.end_date)}` : "", s.goal].filter(Boolean).join(" · ")}
            count={`${list.length} issue${list.length === 1 ? "" : "s"}${s.points ? ` · ${s.points} pts` : ""}`}
            dragged={dragged} onDropIssue={isLead ? drop(s.id) : null}
            actions={isLead && (
              <>
                {s.status === "planned" && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => onStartSprint(s)} data-testid={`start-sprint-${s.id}`}><Play className="h-3.5 w-3.5 mr-1" weight="fill" /> Start</Button>}
                {s.status === "active" && <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => onCompleteSprint(s)} data-testid={`complete-sprint-${s.id}`}><CheckCircle className="h-3.5 w-3.5 mr-1" weight="fill" /> Complete</Button>}
                <button className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Edit sprint" onClick={() => onEditSprint(s)}><PencilSimple className="h-4 w-4" /></button>
                {canDelete && s.status !== "active" && <button className="p-1.5 rounded-lg hover:bg-slate-100 text-red-600" aria-label="Delete sprint" onClick={() => onDeleteSprint(s)}><Trash className="h-4 w-4" /></button>}
              </>
            )}>
            {rows(list)}
          </Section>
        );
      })}

      <Section testId="backlog-section" title="Backlog" count={`${backlog.length} issue${backlog.length === 1 ? "" : "s"}`} dragged={dragged} onDropIssue={isLead ? drop(null) : null}
        actions={isLead && (
          <>
            <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={onNewSprint} data-testid="new-sprint-btn"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> Sprint</Button>
            <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={onNewIssue} data-testid="new-issue-btn"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> Issue</Button>
          </>
        )}>
        {rows(backlog)}
      </Section>

      {completed.length > 0 && (
        <Section title="Completed sprints" count={`${completed.length}`} defaultOpen={false}>
          {completed.map(s => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm" style={{ borderTop: "1px solid var(--border-color)" }}>
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{s.done}/{s.issues} issues done{s.points ? ` · ${s.points_done}/${s.points} pts` : ""}</span>
              {s.completed_at && <span className="text-xs ml-auto" style={{ color: "var(--text-subtle)" }}>Completed {shortDate(s.completed_at.slice(0, 10))}</span>}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
