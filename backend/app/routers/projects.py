"""Jira-style project board (``/api/projects``).

- Every project has a short key (e.g. ``HR``); its issues are numbered ``HR-1``, ``HR-2`` … and have a type
  (task, bug, story, epic), priority, labels, story points, a reporter and an assignee.
- Issues live in the backlog or in a sprint; a project has at most one active sprint, and the board shows it.
- Access follows the "projects" module in the permission matrix (admins always have everything), and nobody
  without a grant can open it at all: View = see every project and comment, Edit = create/edit projects, issues and
  sprints and assign issues (the assignee gets an email), Delete = delete projects, issues and sprints.
  With View, a person can also move the issues assigned to them across the board.
- Every change to an issue is written to its activity history.
"""

import asyncio
import html
import re
from datetime import datetime, timezone

import pymysql
from fastapi import APIRouter, HTTPException, Request

from app.core.permissions import effective_module_permissions, has_permission
from app.core.email import _email_button, _email_field, _email_info_box, _email_layout, _email_paragraph, _send_email
from app.core.security import get_current_user
from app.db import execute_query
from app.services.workflow import TASK_INITIAL, TASK_WORKFLOW, check_initial, check_transition
from app.schemas.projects import CommentIn, ProjectIn, SprintIn, SprintMoveIn, TaskIn, TaskStatusIn


projects_router = APIRouter(prefix="/projects")

TASK_STATUSES = ("todo", "in_progress", "review", "done")
PRIORITIES = ("low", "medium", "high", "urgent")
ISSUE_TYPES = ("task", "bug", "story", "epic")
PROJECT_STATUSES = ("active", "completed", "archived")
KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

async def _has(user: dict, action: str) -> bool:
    if user.get("role") == "admin":
        return True
    return has_permission(await effective_module_permissions(user), "projects", action)

async def _require(request: Request, action: str) -> dict:
    user = await get_current_user(request)
    if not await _has(user, action):
        raise HTTPException(status_code=403, detail=f"You don't have {action} access to projects")
    return user

def _check(value: str, allowed: tuple, label: str) -> str:
    if value not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return value

def _clean_date(value, label: str = "Due date") -> str:
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be in YYYY-MM-DD format")

def _clean_labels(value: str) -> str:
    seen, out = set(), []
    for part in (value or "").split(","):
        label = re.sub(r"\s+", "-", part.strip().lower())[:24]
        if label and label not in seen:
            seen.add(label); out.append(label)
    return ",".join(out[:8])

def _clean_points(value):
    if value is None:
        return None
    if value < 0 or value > 100:
        raise HTTPException(status_code=400, detail="Story points must be between 0 and 100")
    return value

async def _assignee_or_400(assignee_id) -> dict:
    if assignee_id is None:
        return None
    person = await execute_query("SELECT id, name, email FROM users WHERE id = %s", (assignee_id,), fetch_one=True)
    if not person:
        raise HTTPException(status_code=400, detail="Assignee not found")
    return person

async def _project_or_404(project_id: int) -> dict:
    project = await execute_query("SELECT * FROM projects WHERE id = %s", (project_id,), fetch_one=True)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

async def _sprint_for_project(sprint_id, project_id: int) -> dict:
    """The sprint (must belong to the project and not be completed), or None for the backlog."""
    if sprint_id is None:
        return None
    sprint = await execute_query("SELECT * FROM sprints WHERE id = %s", (sprint_id,), fetch_one=True)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=400, detail="Sprint not found in this project")
    if sprint["status"] == "completed":
        raise HTTPException(status_code=400, detail="That sprint is already completed")
    return sprint

def _task_out(r: dict) -> dict:
    return {
        "id": r["id"], "key": f"{r['project_key']}-{r['issue_number']}", "project_id": r["project_id"], "project_name": r.get("project_name"),
        "issue_type": r["issue_type"], "title": r["title"], "description": r["description"] or "", "status": r["status"], "priority": r["priority"],
        "labels": [l for l in (r["labels"] or "").split(",") if l], "story_points": r["story_points"],
        "sprint_id": r["sprint_id"], "sprint_name": r.get("sprint_name"),
        "assignee_id": r["assignee_id"], "assignee_name": r.get("assignee_name"), "assignee_avatar": r.get("assignee_avatar"),
        "reporter_name": r.get("creator_name"), "due_date": r["due_date"], "created_at": r["created_at"],
        "completed_at": r["completed_at"], "comment_count": int(r.get("comment_count") or 0),
    }

_TASK_SELECT = """SELECT t.*, p.name AS project_name, p.project_key, s.name AS sprint_name,
                         a.name AS assignee_name, a.avatar_url AS assignee_avatar, c.name AS creator_name,
                         (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
                  FROM tasks t JOIN projects p ON p.id = t.project_id
                  LEFT JOIN sprints s ON s.id = t.sprint_id
                  LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by"""

async def _load_task(task_id: int) -> dict:
    row = await execute_query(_TASK_SELECT + " WHERE t.id = %s", (task_id,), fetch_one=True)
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return row

async def _log(task_id: int, user: dict, field: str, old, new) -> None:
    """Record one change in the issue's activity history."""
    await execute_query(
        "INSERT INTO task_activity (task_id, user_id, user_name, field, old_value, new_value, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (task_id, user["id"], user["name"], field, None if old is None else str(old)[:255], None if new is None else str(new)[:255], _now())
    )

def _notify_assignee(person: dict, issue_key: str, task_title: str, project_name: str, priority: str, due_date, assigned_by: str) -> None:
    """Email the new assignee (sent from a worker thread; failures are only logged)."""
    if not person or not person.get("email"):
        return
    box = _email_info_box(
        _email_field("Issue", html.escape(f"{issue_key} · {task_title}"), size=18, weight=700)
        + _email_field("Project", html.escape(project_name))
        + _email_field("Priority", html.escape(priority.title()))
        + _email_field("Due", html.escape(due_date or "No due date"))
        + _email_field("Assigned by", html.escape(assigned_by), last=True),
        accent="blue",
    )
    body = box + _email_paragraph(f"Hi {html.escape(person['name'])}, an issue has been assigned to you. Open the Projects tab in the HR Portal to get started.") + _email_button("Open Projects")
    page = _email_layout("New issue assigned", body, eyebrow="Projects", accent="blue")
    asyncio.get_event_loop().run_in_executor(None, _send_email, [person["email"]], f"{issue_key}: {task_title}", page, "projects")


@projects_router.get("/workflow")
async def get_workflow(request: Request):
    """Which status each issue status can move to (the board and dialogs enforce it, so does the API)."""
    await _require(request, "view")
    return {"initial": TASK_INITIAL, "transitions": TASK_WORKFLOW}


# ---------- people / my tasks ----------

@projects_router.get("/people")
async def list_people(request: Request):
    """Everyone an issue can be assigned to."""
    await _require(request, "edit")
    rows = await execute_query(
        "SELECT id, name, position, avatar_url FROM users WHERE role != 'admin' ORDER BY name", fetch_all=True
    )
    return [{"id": r["id"], "name": r["name"], "position": r["position"], "avatar_url": r["avatar_url"]} for r in (rows or [])]

@projects_router.get("/my-tasks")
async def my_tasks(request: Request):
    user = await _require(request, "view")
    rows = await execute_query(
        _TASK_SELECT + " WHERE t.assignee_id = %s ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date", (user["id"],), fetch_all=True
    )
    return [_task_out(r) for r in (rows or [])]


# ---------- projects ----------

async def _unique_key(name: str, wanted: str = None) -> str:
    if wanted:
        key = wanted.strip().upper()
        if not KEY_PATTERN.match(key):
            raise HTTPException(status_code=400, detail="Project key must be 2–10 letters/digits and start with a letter")
        if await execute_query("SELECT id FROM projects WHERE project_key = %s", (key,), fetch_one=True):
            raise HTTPException(status_code=400, detail=f"Project key {key} is already used")
        return key
    words = re.findall(r"[A-Za-z0-9]+", name)
    base = ("".join(w[0] for w in words)[:4] or "PRJ").upper()
    if not base[0].isalpha() or len(base) < 2:
        base = ("P" + base)[:4].ljust(2, "X")
    key, n = base, 1
    while await execute_query("SELECT id FROM projects WHERE project_key = %s", (key,), fetch_one=True):
        n += 1; key = f"{base}{n}"
    return key

@projects_router.get("")
async def list_projects(request: Request):
    user = await _require(request, "view")
    base = """SELECT p.*, u.name AS owner_name,
                     (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total,
                     (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done,
                     (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.assignee_id = %s AND t.status != 'done') AS mine_open,
                     (SELECT name FROM sprints s WHERE s.project_id = p.id AND s.status = 'active' LIMIT 1) AS active_sprint
              FROM projects p LEFT JOIN users u ON u.id = p.owner_id"""
    rows = await execute_query(base + " ORDER BY p.status = 'archived', p.created_at DESC", (user["id"],), fetch_all=True)
    return [
        {"id": r["id"], "name": r["name"], "key": r["project_key"], "description": r["description"] or "", "status": r["status"],
         "owner_name": r["owner_name"], "created_at": r["created_at"], "total": int(r["total"]), "done": int(r["done"]),
         "mine_open": int(r["mine_open"]), "active_sprint": r["active_sprint"]}
        for r in (rows or [])
    ]

@projects_router.post("")
async def create_project(data: ProjectIn, request: Request):
    user = await _require(request, "edit")
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    key = await _unique_key(name, data.key)
    new_id = await execute_query(
        "INSERT INTO projects (name, project_key, description, status, owner_id, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (name[:200], key, data.description or "", _check(data.status, PROJECT_STATUSES, "status"), user["id"], _now(), _now()), last_id=True
    )
    return {"id": new_id, "key": key, "message": "Project created"}

@projects_router.put("/{project_id}")
async def update_project(project_id: int, data: ProjectIn, request: Request):
    await _require(request, "edit")
    await _project_or_404(project_id)   # the key stays as chosen at creation: issue keys already point at it
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    await execute_query(
        "UPDATE projects SET name = %s, description = %s, status = %s, updated_at = %s WHERE id = %s",
        (name[:200], data.description or "", _check(data.status, PROJECT_STATUSES, "status"), _now(), project_id)
    )
    return {"message": "Project updated"}

@projects_router.delete("/{project_id}")
async def delete_project(project_id: int, request: Request):
    await _require(request, "delete")
    await _project_or_404(project_id)
    ids = "SELECT id FROM tasks WHERE project_id = %s"
    await execute_query(f"DELETE FROM task_comments WHERE task_id IN ({ids})", (project_id,))
    await execute_query(f"DELETE FROM task_activity WHERE task_id IN ({ids})", (project_id,))
    await execute_query("DELETE FROM tasks WHERE project_id = %s", (project_id,))
    await execute_query("DELETE FROM sprints WHERE project_id = %s", (project_id,))
    await execute_query("DELETE FROM projects WHERE id = %s", (project_id,))
    return {"message": "Project deleted"}


# ---------- sprints ----------

async def _sprint_or_404(sprint_id: int) -> dict:
    sprint = await execute_query("SELECT * FROM sprints WHERE id = %s", (sprint_id,), fetch_one=True)
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint

def _sprint_out(r: dict) -> dict:
    return {
        "id": r["id"], "project_id": r["project_id"], "name": r["name"], "goal": r["goal"] or "", "status": r["status"],
        "start_date": r["start_date"], "end_date": r["end_date"], "completed_at": r["completed_at"],
        "issues": int(r.get("issues") or 0), "done": int(r.get("done") or 0),
        "points": int(r.get("points") or 0), "points_done": int(r.get("points_done") or 0),
    }

@projects_router.get("/{project_id}/sprints")
async def list_sprints(project_id: int, request: Request):
    await _require(request, "view")
    await _project_or_404(project_id)
    rows = await execute_query(
        """SELECT s.*, COUNT(t.id) AS issues, COALESCE(SUM(t.status = 'done'), 0) AS done,
                  COALESCE(SUM(t.story_points), 0) AS points, COALESCE(SUM(CASE WHEN t.status = 'done' THEN t.story_points END), 0) AS points_done
           FROM sprints s LEFT JOIN tasks t ON t.sprint_id = s.id
           WHERE s.project_id = %s GROUP BY s.id ORDER BY s.status = 'completed', s.id""",
        (project_id,), fetch_all=True
    )
    return [_sprint_out(r) for r in (rows or [])]

@projects_router.post("/{project_id}/sprints")
async def create_sprint(project_id: int, data: SprintIn, request: Request):
    await _require(request, "edit")
    await _project_or_404(project_id)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Sprint name is required")
    start, end = _clean_date(data.start_date, "Start date"), _clean_date(data.end_date, "End date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date can't be before the start date")
    new_id = await execute_query(
        "INSERT INTO sprints (project_id, name, goal, status, start_date, end_date, created_at) VALUES (%s, %s, %s, 'planned', %s, %s, %s)",
        (project_id, name[:150], data.goal or "", start, end, _now()), last_id=True
    )
    return {"id": new_id, "message": "Sprint created"}

@projects_router.put("/sprints/{sprint_id}")
async def update_sprint(sprint_id: int, data: SprintIn, request: Request):
    await _require(request, "edit")
    sprint = await _sprint_or_404(sprint_id)
    if sprint["status"] == "completed":
        raise HTTPException(status_code=400, detail="A completed sprint can't be edited")
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Sprint name is required")
    start, end = _clean_date(data.start_date, "Start date"), _clean_date(data.end_date, "End date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date can't be before the start date")
    await execute_query("UPDATE sprints SET name = %s, goal = %s, start_date = %s, end_date = %s WHERE id = %s",
                        (name[:150], data.goal or "", start, end, sprint_id))
    return {"message": "Sprint updated"}

@projects_router.post("/sprints/{sprint_id}/start")
async def start_sprint(sprint_id: int, request: Request):
    await _require(request, "edit")
    sprint = await _sprint_or_404(sprint_id)
    if sprint["status"] != "planned":
        raise HTTPException(status_code=400, detail="Only a planned sprint can be started")
    active = await execute_query("SELECT name FROM sprints WHERE project_id = %s AND status = 'active'", (sprint["project_id"],), fetch_one=True)
    if active:
        raise HTTPException(status_code=400, detail=f"Complete the active sprint ({active['name']}) first")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await execute_query("UPDATE sprints SET status = 'active', start_date = COALESCE(start_date, %s) WHERE id = %s", (today, sprint_id))
    return {"message": "Sprint started"}

@projects_router.post("/sprints/{sprint_id}/complete")
async def complete_sprint(sprint_id: int, request: Request):
    """Finish the sprint; issues that aren't done go back to the backlog."""
    user = await _require(request, "edit")
    sprint = await _sprint_or_404(sprint_id)
    if sprint["status"] != "active":
        raise HTTPException(status_code=400, detail="Only the active sprint can be completed")
    unfinished = await execute_query("SELECT id FROM tasks WHERE sprint_id = %s AND status != 'done'", (sprint_id,), fetch_all=True)
    for t in (unfinished or []):
        await _log(t["id"], user, "sprint", sprint["name"], "Backlog")
    await execute_query("UPDATE tasks SET sprint_id = NULL WHERE sprint_id = %s AND status != 'done'", (sprint_id,))
    await execute_query("UPDATE sprints SET status = 'completed', completed_at = %s WHERE id = %s", (_now(), sprint_id))
    return {"message": "Sprint completed", "moved_to_backlog": len(unfinished or [])}

@projects_router.delete("/sprints/{sprint_id}")
async def delete_sprint(sprint_id: int, request: Request):
    user = await _require(request, "delete")
    sprint = await _sprint_or_404(sprint_id)
    if sprint["status"] == "active":
        raise HTTPException(status_code=400, detail="Complete the active sprint before deleting it")
    for t in (await execute_query("SELECT id FROM tasks WHERE sprint_id = %s", (sprint_id,), fetch_all=True) or []):
        await _log(t["id"], user, "sprint", sprint["name"], "Backlog")
    await execute_query("UPDATE tasks SET sprint_id = NULL WHERE sprint_id = %s", (sprint_id,))
    await execute_query("DELETE FROM sprints WHERE id = %s", (sprint_id,))
    return {"message": "Sprint deleted"}


# ---------- issues ----------

@projects_router.get("/{project_id}/tasks")
async def list_tasks(project_id: int, request: Request):
    await _require(request, "view")
    await _project_or_404(project_id)
    rows = await execute_query(_TASK_SELECT + " WHERE t.project_id = %s ORDER BY t.issue_number", (project_id,), fetch_all=True)
    return [_task_out(r) for r in (rows or [])]

@projects_router.post("/{project_id}/tasks")
async def create_task(project_id: int, data: TaskIn, request: Request):
    user = await _require(request, "edit")
    project = await _project_or_404(project_id)
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    person = await _assignee_or_400(data.assignee_id)
    await _sprint_for_project(data.sprint_id, project_id)
    status = _check(data.status, TASK_STATUSES, "status")
    check_initial(TASK_INITIAL, status)
    priority = _check(data.priority, PRIORITIES, "priority")
    issue_type = _check(data.issue_type, ISSUE_TYPES, "issue type")
    due = _clean_date(data.due_date)
    # Number = highest + 1. Two creates at once can pick the same number; the unique key rejects the second, so retry.
    new_id = None
    for attempt in range(5):
        number = (await execute_query("SELECT COALESCE(MAX(issue_number), 0) + 1 AS n FROM tasks WHERE project_id = %s", (project_id,), fetch_one=True))["n"]
        try:
            new_id = await execute_query(
                """INSERT INTO tasks (project_id, issue_number, issue_type, title, description, status, priority, labels, story_points, sprint_id,
                                      assignee_id, created_by, due_date, created_at, updated_at, completed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (project_id, number, issue_type, title[:255], data.description or "", status, priority, _clean_labels(data.labels), _clean_points(data.story_points),
                 data.sprint_id, data.assignee_id, user["id"], due, _now(), _now(), _now() if status == "done" else None),
                last_id=True
            )
            break
        except pymysql.err.IntegrityError as e:
            if e.args[0] != 1062 or attempt == 4:
                raise
    await _log(new_id, user, "created", None, f"{project['project_key']}-{number}")
    if person and person["id"] != user["id"]:
        _notify_assignee(person, f"{project['project_key']}-{number}", title, project["name"], priority, due, user["name"])
    return _task_out(await _load_task(new_id))

@projects_router.put("/tasks/{task_id}")
async def update_task(task_id: int, data: TaskIn, request: Request):
    user = await _require(request, "edit")
    task = await _load_task(task_id)
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    person = await _assignee_or_400(data.assignee_id)
    sprint = await _sprint_for_project(data.sprint_id, task["project_id"]) if data.sprint_id != task["sprint_id"] else None
    status = _check(data.status, TASK_STATUSES, "status")
    check_transition(TASK_WORKFLOW, task["status"], status)
    priority = _check(data.priority, PRIORITIES, "priority")
    issue_type = _check(data.issue_type, ISSUE_TYPES, "issue type")
    due, labels, points = _clean_date(data.due_date), _clean_labels(data.labels), _clean_points(data.story_points)
    completed_at = task["completed_at"] if status == "done" and task["completed_at"] else (_now() if status == "done" else None)
    await execute_query(
        """UPDATE tasks SET title = %s, description = %s, issue_type = %s, status = %s, priority = %s, labels = %s, story_points = %s,
           sprint_id = %s, assignee_id = %s, due_date = %s, completed_at = %s, updated_at = %s WHERE id = %s""",
        (title[:255], data.description or "", issue_type, status, priority, labels, points, data.sprint_id, data.assignee_id, due, completed_at, _now(), task_id)
    )
    changes = [
        ("title", task["title"], title), ("type", task["issue_type"], issue_type), ("status", task["status"], status),
        ("priority", task["priority"], priority), ("assignee", task["assignee_name"], person["name"] if person else None),
        ("story points", task["story_points"], points), ("due date", task["due_date"], due), ("labels", task["labels"], labels),
        ("sprint", task["sprint_name"], sprint["name"] if sprint else (task["sprint_name"] if data.sprint_id == task["sprint_id"] else None)),
        ("description", task["description"] or "", data.description or ""),
    ]
    for field, old, new in changes:
        if (old or None) != (new or None):
            await _log(task_id, user, field, None if field == "description" else old, None if field == "description" else new)
    if person and person["id"] != task["assignee_id"] and person["id"] != user["id"]:
        _notify_assignee(person, f"{task['project_key']}-{task['issue_number']}", title, task["project_name"], priority, due, user["name"])
    return _task_out(await _load_task(task_id))

@projects_router.put("/tasks/{task_id}/status")
async def update_task_status(task_id: int, data: TaskStatusIn, request: Request):
    """The assignee (or a lead) moves an issue between columns."""
    user = await _require(request, "view")
    task = await _load_task(task_id)
    if not await _has(user, "edit") and task["assignee_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only update issues assigned to you")
    status = _check(data.status, TASK_STATUSES, "status")
    check_transition(TASK_WORKFLOW, task["status"], status)
    if status != task["status"]:
        completed_at = task["completed_at"] if status == "done" and task["completed_at"] else (_now() if status == "done" else None)
        await execute_query("UPDATE tasks SET status = %s, completed_at = %s, updated_at = %s WHERE id = %s", (status, completed_at, _now(), task_id))
        await _log(task_id, user, "status", task["status"], status)
    return _task_out(await _load_task(task_id))

@projects_router.put("/tasks/{task_id}/sprint")
async def move_task_to_sprint(task_id: int, data: SprintMoveIn, request: Request):
    """Backlog ⇄ sprint (``sprint_id`` null = backlog)."""
    user = await _require(request, "edit")
    task = await _load_task(task_id)
    sprint = await _sprint_for_project(data.sprint_id, task["project_id"])
    if data.sprint_id != task["sprint_id"]:
        await execute_query("UPDATE tasks SET sprint_id = %s, updated_at = %s WHERE id = %s", (data.sprint_id, _now(), task_id))
        await _log(task_id, user, "sprint", task["sprint_name"] or "Backlog", sprint["name"] if sprint else "Backlog")
    return _task_out(await _load_task(task_id))

@projects_router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, request: Request):
    await _require(request, "delete")
    await _load_task(task_id)
    await execute_query("DELETE FROM task_comments WHERE task_id = %s", (task_id,))
    await execute_query("DELETE FROM task_activity WHERE task_id = %s", (task_id,))
    await execute_query("DELETE FROM tasks WHERE id = %s", (task_id,))
    return {"message": "Issue deleted"}


# ---------- comments & history ----------

@projects_router.get("/tasks/{task_id}/comments")
async def list_comments(task_id: int, request: Request):
    await _require(request, "view")
    await _load_task(task_id)
    rows = await execute_query(
        "SELECT c.id, c.body, c.created_at, c.user_id, u.name AS user_name, u.avatar_url FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = %s ORDER BY c.id",
        (task_id,), fetch_all=True
    )
    return [dict(r) for r in (rows or [])]

@projects_router.post("/tasks/{task_id}/comments")
async def add_comment(task_id: int, data: CommentIn, request: Request):
    user = await _require(request, "view")
    await _load_task(task_id)
    body = (data.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    await execute_query("INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES (%s, %s, %s, %s)", (task_id, user["id"], body[:2000], _now()))
    return {"message": "Comment added"}

@projects_router.get("/tasks/{task_id}/activity")
async def list_activity(task_id: int, request: Request):
    await _require(request, "view")
    await _load_task(task_id)
    rows = await execute_query(
        "SELECT id, user_name, field, old_value, new_value, created_at FROM task_activity WHERE task_id = %s ORDER BY id DESC", (task_id,), fetch_all=True
    )
    return [dict(r) for r in (rows or [])]
