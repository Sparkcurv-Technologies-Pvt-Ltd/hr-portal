"""Request bodies for client server monitoring."""

from typing import Optional

from pydantic import BaseModel


class MonitorIn(BaseModel):
    client_id: int
    name: str
    type: str                       # http | tcp | agent
    target: str = ""                # URL (http) or host (tcp); unused for agent
    port: Optional[int] = None      # tcp only
    expected_text: str = ""         # http only: the page must contain this
    interval_seconds: int = 300
    timeout_seconds: int = 10
    fail_threshold: int = 2         # consecutive failures before it counts as down
    enabled: bool = True
    auto_ticket: bool = True        # open a ticket when it goes down, resolve it on recovery
    visible_to_client: bool = True
    cpu_max: int = 90               # agent: above this a monitor shows as degraded
    mem_max: int = 90
    disk_max: int = 90


class AgentReport(BaseModel):
    cpu_percent: float
    mem_percent: float
    disk_percent: float
