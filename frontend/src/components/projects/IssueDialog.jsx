import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Trash, PaperPlaneTilt } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/common/Avatar";
import { COLUMNS, ISSUE_TYPES, PRIORITIES, STATUS_LABEL, selectClass, canMoveIssue, canTransition } from "./constants";
import { TypeIcon } from "./IssueBits";

const EMPTY = { title: "", description: "", issue_type: "task", assignee_id: "", priority: "medium", status: "todo", story_points: "", sprint_id: "", labels: "", due_date: "" };

const describe = (a) => {
  if (a.field === "created") return <>created this issue</>;
  if (a.field === "description") return <>updated the description</>;
  const show = (v) => (a.field === "status" ? STATUS_LABEL[v] : v) || "None";
  return <>changed <strong>{a.field}</strong> from <em>{show(a.old_value)}</em> to <em>{show(a.new_value)}</em></>;
};

// Create / edit / view one issue, with its comments and change history
export function IssueDialog({ open, onOpenChange, api, user, isLead, canDelete, workflow, issue, defaults, people, sprints, onSaved, onMoveStatus }) {
  const [form, setForm] = useState(EMPTY);
  const [tab, setTab] = useState("comments");
  const [comments, setComments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stale = false;   // ignore late responses for an issue we've since closed or switched away from
    setTab("comments"); setCommentText(""); setComments([]); setActivity([]);
    if (issue) {
      setForm({
        title: issue.title, description: issue.description, issue_type: issue.issue_type, assignee_id: issue.assignee_id || "", priority: issue.priority,
        status: issue.status, story_points: issue.story_points ?? "", sprint_id: issue.sprint_id || "", labels: issue.labels.join(", "), due_date: issue.due_date || "",
      });
      api.get(`/projects/tasks/${issue.id}/comments`).then(r => { if (!stale) setComments(r.data); }).catch(() => {});
      api.get(`/projects/tasks/${issue.id}/activity`).then(r => { if (!stale) setActivity(r.data); }).catch(() => {});
    } else {
      setForm({ ...EMPTY, ...defaults });
    }
    return () => { stale = true; };
  }, [open, issue, defaults, api]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canMove = issue && canMoveIssue(user, isLead, issue);
  const readOnly = !isLead;
  const assignable = sprints.filter(s => s.status !== "completed" || s.id === issue?.sprint_id);

  const payload = () => ({
    ...form, assignee_id: form.assignee_id ? Number(form.assignee_id) : null, sprint_id: form.sprint_id ? Number(form.sprint_id) : null,
    story_points: form.story_points === "" ? null : Number(form.story_points), due_date: form.due_date || null,
  });

  const save = async () => {
    if (!form.title.trim()) return toast.error("Enter a title");
    setSaving(true);
    try {
      if (issue) { await api.put(`/projects/tasks/${issue.id}`, payload()); toast.success("Issue updated"); }
      else { await api.post(`/projects/${defaults.projectId}/tasks`, payload()); toast.success("Issue created"); }
      onOpenChange(false); onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save issue"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${issue.key}?`)) return;
    try { await api.delete(`/projects/tasks/${issue.id}`); toast.success("Issue deleted"); onOpenChange(false); onSaved(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to delete issue"); }
  };

  const sendComment = async () => {
    if (!commentText.trim() || !issue) return;
    try {
      await api.post(`/projects/tasks/${issue.id}/comments`, { body: commentText });
      setCommentText("");
      setComments((await api.get(`/projects/tasks/${issue.id}/comments`)).data);
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to add comment"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {issue ? <><TypeIcon type={form.issue_type} /> <span className="text-sm font-semibold" style={{ color: "var(--text-subtle)" }}>{issue.key}</span></> : "New issue"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div><Label>Title</Label><Input value={form.title} disabled={readOnly} onChange={e => set("title", e.target.value)} data-testid="task-title-input" /></div>
          <div><Label>Description</Label><Textarea rows={3} value={form.description} disabled={readOnly} onChange={e => set("description", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label>
              <select className={selectClass} value={form.issue_type} disabled={readOnly} onChange={e => set("issue_type", e.target.value)} data-testid="issue-type-select">
                {ISSUE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
            <div><Label>Priority</Label>
              <select className={selectClass} value={form.priority} disabled={readOnly} onChange={e => set("priority", e.target.value)}>
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
            <div className="col-span-2 sm:col-span-1"><Label>Assignee</Label>
              {isLead ? (
                <select className={selectClass} value={form.assignee_id} onChange={e => set("assignee_id", e.target.value)} data-testid="task-assignee-select">
                  <option value="">Unassigned</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.position ? ` — ${p.position}` : ""}</option>)}
                </select>
              ) : <Input disabled value={issue?.assignee_name || "Unassigned"} />}</div>
            <div className="col-span-2 sm:col-span-1"><Label>Status</Label>
              <select className={selectClass} value={form.status} disabled={!issue || !canMove} onChange={e => set("status", e.target.value)} data-testid="issue-status-select">
                {COLUMNS.filter(c => !issue || canTransition(workflow, issue.status, c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
            <div><Label>Sprint</Label>
              <select className={selectClass} value={form.sprint_id} disabled={readOnly} onChange={e => set("sprint_id", e.target.value)} data-testid="issue-sprint-select">
                <option value="">Backlog</option>
                {assignable.map(s => <option key={s.id} value={s.id}>{s.name}{s.status === "active" ? " (active)" : ""}</option>)}</select></div>
            <div><Label>Story points</Label><Input type="number" min="0" max="100" value={form.story_points} disabled={readOnly} onChange={e => set("story_points", e.target.value)} data-testid="issue-points-input" /></div>
            <div><Label>Due date</Label><Input type="date" value={form.due_date} disabled={readOnly} onChange={e => set("due_date", e.target.value)} /></div>
            <div><Label>Labels</Label><Input placeholder="api, urgent" value={form.labels} disabled={readOnly} onChange={e => set("labels", e.target.value)} data-testid="issue-labels-input" /></div>
          </div>
          {issue && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Reported by {issue.reporter_name || "—"} · {format(new Date(issue.created_at), "d MMM yyyy")}</p>}

          {(isLead || (issue && canMove)) && (
            <div className="flex gap-2">
              {canDelete && issue && <Button variant="outline" className="rounded-xl h-10 text-red-600" onClick={remove} aria-label="Delete issue"><Trash className="h-4 w-4" /></Button>}
              <Button onClick={isLead ? save : async () => { if (await onMoveStatus(issue, form.status)) onOpenChange(false); }} disabled={saving || (!isLead && form.status === issue?.status)}
                className="flex-1 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-task-btn">
                {saving ? "Saving…" : isLead ? (issue ? "Save issue" : "Create issue") : `Update status (${STATUS_LABEL[form.status]})`}
              </Button>
            </div>
          )}

          {issue && (
            <div className="pt-4" style={{ borderTop: "1px solid var(--border-color)" }}>
              <div className="flex gap-4 mb-3">
                {[["comments", `Comments (${comments.length})`], ["history", `History (${activity.length})`]].map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} data-testid={`issue-tab-${k}`} className="text-sm font-bold pb-1"
                    style={{ color: tab === k ? "var(--brand-primary)" : "var(--text-subtle)", borderBottom: tab === k ? "2px solid var(--brand-primary)" : "2px solid transparent" }}>{label}</button>
                ))}
              </div>
              {tab === "comments" ? (
                <>
                  <div className="space-y-3 mb-3 max-h-48 overflow-y-auto">
                    {comments.length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>No comments yet</p>}
                    {comments.map(c => (
                      <div key={c.id} className="flex gap-2">
                        <Avatar url={c.avatar_url} name={c.user_name} size="h-7 w-7" textSize="text-[10px]" />
                        <div className="min-w-0">
                          <p className="text-xs"><strong>{c.user_name}</strong> <span style={{ color: "var(--text-subtle)" }}>{format(new Date(c.created_at), "d MMM, h:mm a")}</span></p>
                          <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder="Write a comment…" value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => e.key === "Enter" && sendComment()} data-testid="comment-input" />
                    <Button onClick={sendComment} className="rounded-xl h-10 bg-[#0020F8] text-white hover:bg-[#0019C4]" aria-label="Send comment"><PaperPlaneTilt className="h-4 w-4" /></Button>
                  </div>
                </>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto" data-testid="issue-history">
                  {activity.map(a => (
                    <p key={a.id} className="text-xs break-words" style={{ color: "var(--text-muted)" }}>
                      <strong style={{ color: "var(--text-primary)" }}>{a.user_name}</strong> {describe(a)} <span style={{ color: "var(--text-subtle)" }}>· {format(new Date(a.created_at), "d MMM, h:mm a")}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
