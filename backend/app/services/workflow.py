"""Status workflows for project issues and client tickets: which status may move to which.

Each workflow maps a status to the statuses it can move to next. Moves outside it are refused everywhere
(boards, dialogs and the API), so work can't skip a step — e.g. an issue can't jump from To Do straight to Done.
New issues and tickets start at the first status. The frontend reads these from the API, so this is the only place to edit.
"""

from fastapi import HTTPException

TASK_WORKFLOW = {
    "todo": ["in_progress"],
    "in_progress": ["todo", "review"],
    "review": ["in_progress", "done"],
    "done": ["in_progress"],          # reopen
}
TASK_INITIAL = "todo"

TICKET_WORKFLOW = {
    "open": ["in_progress", "waiting_client", "resolved"],
    "in_progress": ["open", "waiting_client", "resolved"],
    "waiting_client": ["open", "in_progress", "resolved"],
    "resolved": ["closed", "open", "in_progress"],   # closed after confirmation; reopen if it isn't fixed
    "closed": ["open"],                              # reopen
}
TICKET_INITIAL = "open"

_LABELS = {
    "todo": "To Do", "in_progress": "In Progress", "review": "Review", "done": "Done",
    "open": "Open", "waiting_client": "Waiting on client", "resolved": "Resolved", "closed": "Closed",
}


def label(status: str) -> str:
    return _LABELS.get(status, status)


def check_transition(workflow: dict, old: str, new: str) -> None:
    """Raise 400 unless ``old`` → ``new`` is allowed (staying on the same status is always fine)."""
    if old == new:
        return
    allowed = workflow.get(old, [])
    if new not in allowed:
        options = ", ".join(label(s) for s in allowed) or "nothing"
        raise HTTPException(status_code=400, detail=f"Can't move from {label(old)} to {label(new)}. From {label(old)} you can move to: {options}.")


def check_initial(initial: str, status: str) -> None:
    if status != initial:
        raise HTTPException(status_code=400, detail=f"New items start as {label(initial)}")
