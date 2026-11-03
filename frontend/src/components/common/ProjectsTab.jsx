import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Kanban, Plus, PencilSimple, Trash, ListChecks, FolderSimple, ArrowLeft, ListDashes } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canDo } from "@/lib/permissions";
import { WorkflowInfo } from "@/components/projects/WorkflowInfo";
import { Board } from "@/components/projects/Board";
import { Backlog } from "@/components/projects/Backlog";
import { FilterBar } from "@/components/projects/FilterBar";
import { IssueDialog } from "@/components/projects/IssueDialog";
import { SprintDialog } from "@/components/projects/SprintDialog";
import { COLUMNS, STATUS_LABEL, EMPTY_FILTERS, applyFilters, canTransition, isOverdue, selectClass, transitionError } from "@/components/projects/constants";

const EMPTY_PROJECT = { name: "", key: "", description: "", status: "active" };
const apiError = (e, fallback) => e.response?.data?.detail || fallback;

// Jira-style projects: issue keys and types, a drag-and-drop board for the active sprint, a backlog with sprints,
// filters and per-issue history. Access follows the "Projects & Tasks" row of the permission matrix:
// View = every project (and work the issues assigned to you), Edit = plan and assign (`isLead` below), Delete = delete.
// Without a grant the page isn't shown at all.
export function ProjectsTab({ api, user }) {
  const isLead = canDo(user, "projects", "edit");
  const canDelete = canDo(user, "projects", "delete");
  const [view, setView] = useState("my");              // overview: "my" | "projects"
  const [section, setSection] = useState("board");     // inside a project: "board" | "backlog"
  const [boardSprint, setBoardSprint] = useState("");  // "" = active sprint (or everything when none is active) | "all" | sprint id
  const [projects, setProjects] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [workflow, setWorkflow] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [projectDialog, setProjectDialog] = useState(false);
  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT);
  const [editingProject, setEditingProject] = useState(null);
  const [issueDialog, setIssueDialog] = useState(false);
  const [issue, setIssue] = useState(null);
  const [issueDefaults, setIssueDefaults] = useState({});
  const [sprintDialog, setSprintDialog] = useState(false);
  const [editingSprint, setEditingSprint] = useState(null);

  const loadOverview = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.get("/projects"), api.get("/projects/my-tasks")]);
      setProjects(p.data); setMyTasks(m.data);
    } catch (e) { toast.error(apiError(e, "Failed to load projects")); }
    finally { setLoading(false); }
  }, [api]);

  const projectSeq = useRef(0);   // a slow response for a project we've since left (or switched from) must not land on the screen
  const loadProject = useCallback(async (id) => {
    const seq = ++projectSeq.current;
    try {
      const [t, s] = await Promise.all([api.get(`/projects/${id}/tasks`), api.get(`/projects/${id}/sprints`)]);
      if (seq !== projectSeq.current) return;
      setTasks(t.data); setSprints(s.data);
    } catch (e) { if (seq === projectSeq.current) toast.error(apiError(e, "Failed to load project")); }
  }, [api]);

  useEffect(() => {
    loadOverview();
    api.get("/projects/workflow").then(r => setWorkflow(r.data)).catch(() => {});
    if (isLead) api.get("/projects/people").then(r => setPeople(r.data)).catch(() => {});
  }, [loadOverview, isLead, api]);

  const refresh = async () => { await loadOverview(); if (project) await loadProject(project.id); };
  const openProject = (p) => { setProject(p); setTasks([]); setSprints([]); setFilters(EMPTY_FILTERS); setSection("board"); setBoardSprint(""); loadProject(p.id); };
  const backToList = () => { projectSeq.current++; setProject(null); loadOverview(); };

  const run = async (fn, ok, fail) => {
    try { const r = await fn(); if (ok) toast.success(typeof ok === "function" ? ok(r) : ok); await refresh(); return true; }
    catch (e) { toast.error(apiError(e, fail)); return false; }
  };

  const saveProject = async () => {
    if (!projectForm.name.trim()) return toast.error("Enter a project name");
    setSaving(true);
    try {
      if (editingProject) {
        await api.put(`/projects/${editingProject.id}`, projectForm);
        setProject(prev => prev && prev.id === editingProject.id ? { ...prev, name: projectForm.name, description: projectForm.description, status: projectForm.status } : prev);
        toast.success("Project updated");
      } else { await api.post("/projects", { ...projectForm, key: projectForm.key.trim() || null }); toast.success("Project created"); }
      setProjectDialog(false); loadOverview();
    } catch (e) { toast.error(apiError(e, "Failed to save project")); }
    finally { setSaving(false); }
  };
  const deleteProject = async (p) => {
    if (!window.confirm(`Delete project "${p.name}" and all its issues?`)) return;
    try { await api.delete(`/projects/${p.id}`); toast.success("Project deleted"); backToList(); }
    catch (e) { toast.error(apiError(e, "Failed to delete project")); }
  };

  const openIssue = (t) => { setIssue(t); setIssueDialog(true); };
  const newIssue = (sprintId = "") => { setIssue(null); setIssueDefaults({ projectId: project.id, sprint_id: sprintId }); setIssueDialog(true); };
  const moveStatus = (t, status) => !canTransition(workflow, t.status, status)
    ? (toast.error(transitionError(workflow, t.status, status, STATUS_LABEL)), false)
    : run(() => api.put(`/projects/tasks/${t.id}/status`, { status }), null, "Failed to update issue");
  const moveToSprint = (t, sprintId) => run(() => api.put(`/projects/tasks/${t.id}/sprint`, { sprint_id: sprintId }), null, "Failed to move issue");

  const saveSprint = async (data) => {
    setSaving(true);
    const ok = await run(() => editingSprint ? api.put(`/projects/sprints/${editingSprint.id}`, data) : api.post(`/projects/${project.id}/sprints`, data), editingSprint ? "Sprint updated" : "Sprint created", "Failed to save sprint");
    setSaving(false);
    if (ok) setSprintDialog(false);
  };
  const startSprint = (s) => run(() => api.post(`/projects/sprints/${s.id}/start`), `${s.name} started`, "Failed to start sprint");
  const completeSprint = (s) => window.confirm(`Complete ${s.name}? Issues that aren't done move back to the backlog.`) &&
    run(() => api.post(`/projects/sprints/${s.id}/complete`), r => `${s.name} completed${r.data.moved_to_backlog ? ` — ${r.data.moved_to_backlog} issue(s) back to the backlog` : ""}`, "Failed to complete sprint");
  const deleteSprint = (s) => window.confirm(`Delete ${s.name}? Its issues move to the backlog.`) &&
    run(() => api.delete(`/projects/sprints/${s.id}`), "Sprint deleted", "Failed to delete sprint");

  const stats = useMemo(() => ({
    open: myTasks.filter(t => t.status !== "done").length, overdue: myTasks.filter(isOverdue).length, done: myTasks.filter(t => t.status === "done").length,
  }), [myTasks]);

  const activeSprint = sprints.find(s => s.status === "active");
  const boardScope = boardSprint || (activeSprint ? String(activeSprint.id) : "all");
  const boardTasks = tasks.filter(t => boardScope === "all" || String(t.sprint_id) === boardScope);
  const assignees = useMemo(() => {
    const seen = new Map();
    tasks.forEach(t => t.assignee_id && seen.set(t.assignee_id, { id: t.assignee_id, name: t.assignee_name }));
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {project && (
          <button onClick={backToList} className="flex items-center gap-1 text-xs font-semibold mb-1" style={{ color: "var(--brand-primary)" }} data-testid="back-to-projects">
            <ArrowLeft className="h-3.5 w-3.5" weight="bold" /> All projects
          </button>
        )}
        <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight break-words">
          {project ? <>{project.name} <span className="text-base font-semibold align-middle" style={{ color: "var(--text-subtle)" }}>{project.key}</span></> : "Projects & Tasks"}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">{project ? (project.description || "Project board") : isLead ? "Plan sprints, assign issues and track progress" : "Your assigned issues and the projects you're working on"}</p>
      </div>
      {isLead && (
        <div className="flex gap-2">
          {project ? (
            <>
              <Button variant="outline" className="rounded-xl h-10" onClick={() => { setEditingProject(project); setProjectForm({ name: project.name, key: project.key, description: project.description || "", status: project.status }); setProjectDialog(true); }}><PencilSimple className="h-4 w-4 mr-1.5" /> Edit</Button>
              {canDelete && <Button variant="outline" className="rounded-xl h-10 text-red-600" aria-label="Delete project" onClick={() => deleteProject(project)}><Trash className="h-4 w-4" /></Button>}
              <Button data-testid="add-task-btn" onClick={() => newIssue(activeSprint && section === "board" ? String(activeSprint.id) : "")} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> Create issue</Button>
            </>
          ) : (
            <Button data-testid="add-project-btn" onClick={() => { setEditingProject(null); setProjectForm(EMPTY_PROJECT); setProjectDialog(true); }} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> New Project</Button>
          )}
        </div>
      )}
    </div>
  );

  const tabButton = (key, label, Icon, current, set, testId) => (
    <button key={key} onClick={() => set(key)} data-testid={testId}
      className="flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold"
      style={current === key ? { background: "var(--brand-primary)", color: "#fff" } : { background: "var(--surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
      <Icon className="h-4 w-4" weight="duotone" /> {label}
    </button>
  );
  const empty = (Icon, title, hint) => (
    <div className="section-card"><div className="flex flex-col items-center text-center py-14 px-6 gap-3">
      <span className="stat-icon tone-blue"><Icon className="h-5 w-5" weight="duotone" /></span>
      <p className="text-sm font-semibold text-slate-900">{title}</p>{hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div></div>
  );

  return (
    <>
      {header}

      {!project && (
        <>
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
            {[["My open issues", stats.open, "tone-blue"], ["Overdue", stats.overdue, "tone-red"], ["Completed", stats.done, "tone-green"]].map(([label, value, tone]) => (
              <div key={label} className={`stat-card ${tone}`}><div className="stat-top"><span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{label}</span></div>
                <p className="text-2xl font-bold mt-2" style={{ color: "var(--tone)" }}>{value}</p></div>
            ))}
          </div>
          <div className="flex gap-2 mb-5">
            {tabButton("my", "My Issues", ListChecks, view, setView, "projects-view-my")}
            {tabButton("projects", "Projects", FolderSimple, view, setView, "projects-view-projects")}
          </div>

          {view === "my" && !loading && (myTasks.length === 0 ? empty(ListChecks, "No issues assigned to you", "Issues assigned to you will show up here.")
            : <Board tasks={myTasks} user={user} isLead={false} workflow={workflow} onOpen={openIssue} onMove={moveStatus} />)}

          {view === "projects" && !loading && (projects.length === 0 ? empty(Kanban, "No projects yet", isLead ? "Click New Project to create one." : null) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map(p => {
                const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                return (
                  <button key={p.id} onClick={() => openProject(p)} data-testid={`project-card-${p.id}`} className="stat-card text-left" style={{ display: "block" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold font-['Outfit'] break-words" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                        <p className="text-[11px] font-semibold" style={{ color: "var(--text-subtle)" }}>{p.key}</p>
                      </div>
                      <span className={`chip ${p.status === "active" ? "tone-green" : p.status === "completed" ? "tone-blue" : "tone-amber"} flex-shrink-0`}>{p.status}</span>
                    </div>
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.description || "No description"}</p>
                    <div className="h-1.5 rounded-full mt-4 overflow-hidden" style={{ background: "var(--border-color)" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--brand-primary)" }} /></div>
                    <div className="flex justify-between text-[11px] mt-2" style={{ color: "var(--text-subtle)" }}>
                      <span>{p.done}/{p.total} issues done{p.active_sprint ? ` · ${p.active_sprint}` : ""}</span>
                      {p.mine_open > 0 && <span className="font-semibold" style={{ color: "var(--brand-primary)" }}>{p.mine_open} yours</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </>
      )}

      {project && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {tabButton("board", "Board", Kanban, section, setSection, "project-section-board")}
            {tabButton("backlog", "Backlog", ListDashes, section, setSection, "project-section-backlog")}
            <WorkflowInfo title="Issue workflow" statuses={COLUMNS} workflow={workflow} />
            {section === "board" && (
              <select className="h-9 rounded-xl border px-2.5 text-sm bg-white ml-auto max-w-full" value={boardScope} onChange={e => setBoardSprint(e.target.value)} aria-label="Sprint" data-testid="board-sprint-select">
                {sprints.filter(s => s.status !== "planned").map(s => <option key={s.id} value={String(s.id)}>{s.name}{s.status === "active" ? " (active)" : " (completed)"}</option>)}
                <option value="all">All issues</option>
              </select>
            )}
          </div>
          <FilterBar filters={filters} setFilters={setFilters} assignees={assignees} />
          {section === "board" ? (
            <>
              {activeSprint && boardScope === String(activeSprint.id) && (
                <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}><strong>{activeSprint.name}</strong>{activeSprint.goal ? ` — ${activeSprint.goal}` : ""} · {activeSprint.done}/{activeSprint.issues} issues done{activeSprint.points ? ` · ${activeSprint.points_done}/${activeSprint.points} points` : ""}</p>
              )}
              <Board tasks={applyFilters(boardTasks, filters)} user={user} isLead={isLead} workflow={workflow} onOpen={openIssue} onMove={moveStatus} />
            </>
          ) : (
            <Backlog tasks={applyFilters(tasks, filters)} sprints={sprints} user={user} isLead={isLead} canDelete={canDelete} workflow={workflow} onOpen={openIssue} onMove={moveStatus} onMoveToSprint={moveToSprint}
              onNewIssue={() => newIssue("")} onNewSprint={() => { setEditingSprint(null); setSprintDialog(true); }}
              onEditSprint={(s) => { setEditingSprint(s); setSprintDialog(true); }} onStartSprint={startSprint} onCompleteSprint={completeSprint} onDeleteSprint={deleteSprint} />
          )}
        </>
      )}

      <Dialog open={projectDialog} onOpenChange={setProjectDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingProject ? "Edit project" : "New project"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} data-testid="project-name-input" /></div>
            <div><Label>Key</Label>
              <Input value={projectForm.key} disabled={!!editingProject} placeholder="Auto, e.g. HR" maxLength={10} onChange={e => setProjectForm({ ...projectForm, key: e.target.value.toUpperCase() })} data-testid="project-key-input" />
              <p className="text-[11px] mt-1" style={{ color: "var(--text-subtle)" }}>Issues are numbered with it (HR-1, HR-2…). It can't be changed later.</p></div>
            <div><Label>Description</Label><Textarea rows={3} value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })} /></div>
            <div><Label>Status</Label>
              <select className={selectClass} value={projectForm.status} onChange={e => setProjectForm({ ...projectForm, status: e.target.value })}>
                <option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option></select></div>
            <Button onClick={saveProject} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-project-btn">{saving ? "Saving…" : "Save project"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <IssueDialog open={issueDialog} onOpenChange={setIssueDialog} api={api} user={user} isLead={isLead} canDelete={canDelete} workflow={workflow} issue={issue} defaults={issueDefaults}
        people={people} sprints={sprints} onSaved={refresh} onMoveStatus={moveStatus} />
      <SprintDialog open={sprintDialog} onOpenChange={setSprintDialog} sprint={editingSprint} defaultName={`Sprint ${sprints.length + 1}`} saving={saving} onSave={saveSprint} />
    </>
  );
}
