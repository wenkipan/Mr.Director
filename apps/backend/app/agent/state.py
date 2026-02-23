"""Agent state: conversation history + current timeline + project context."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.timeline import TimelineProject


@dataclass
class AgentState:
    project_id: str
    media_dir: str = ""
    conversation_history: list[dict] = field(default_factory=list)
    current_timeline: TimelineProject | None = None
    _pending_user_response: str | None = None
