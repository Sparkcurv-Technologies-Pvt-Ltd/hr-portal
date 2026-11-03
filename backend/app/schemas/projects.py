"""Request bodies for the project / issue board."""

from typing import Optional

from pydantic import BaseModel


class ProjectIn(BaseModel):
    name: str
    key: Optional[str] = None   # short issue prefix, e.g. HR -> HR-1; chosen once, at creation
    description: str = ""
    status: str = "active"   # active | completed | archived


class TaskIn(BaseModel):
    title: str
    description: str = ""
    assignee_id: Optional[int] = None
    priority: str = "medium"   # low | medium | high | urgent
    status: str = "todo"       # todo | in_progress | review | done
    issue_type: str = "task"   # task | bug | story | epic
    labels: str = ""           # comma separated
    story_points: Optional[int] = None
    sprint_id: Optional[int] = None   # None = backlog
    due_date: Optional[str] = None   # YYYY-MM-DD


class TaskStatusIn(BaseModel):
    status: str


class CommentIn(BaseModel):
    body: str


class SprintIn(BaseModel):
    name: str
    goal: str = ""
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class SprintMoveIn(BaseModel):
    sprint_id: Optional[int] = None
