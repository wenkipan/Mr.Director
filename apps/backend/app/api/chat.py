"""Chat API endpoint — bridges user messages to the ReAct Agent."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter

from app.agent.loop import ReActAgent
from app.agent.state import AgentState
from app.config import settings
from app.models.messages import ChatRequest, ChatResponse
from app.models.timeline import TimelineProject, migrate_project_data
from app.services.ws_manager import ws_manager

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory agent states per project (lost on restart — fine for MVP)
_agent_states: dict[str, AgentState] = {}


def get_or_create_state(project_id: str) -> AgentState:
    """Get existing state or create one by loading from disk.

    This is the SOLE entry point for accessing project state.
    Once loaded, in-memory state is the source of truth.
    Disk is only read on first access (cold start).
    """
    if project_id not in _agent_states:
        state = AgentState(project_id=project_id)
        # Load from disk only on first access
        path = Path(settings.projects_dir) / f"{project_id}.json"
        if path.exists():
            try:
                data = migrate_project_data(json.loads(path.read_text()))
                state.current_timeline = TimelineProject(**data)
            except Exception as e:
                logger.warning(f"Failed to load timeline for {project_id}: {e}")
        _agent_states[project_id] = state

    return _agent_states[project_id]


@router.post("/chat")
async def chat_message(req: ChatRequest) -> ChatResponse:
    """Send a user message to the agent and get a response."""
    state = get_or_create_state(req.project_id)

    # If user mentions a directory, remember it as the media dir
    # (simple heuristic — agent can also set this via tools)
    if not state.media_dir:
        for word in req.message.split():
            if word.startswith("/") and len(word) > 2:
                p = Path(word)
                if p.is_dir():
                    state.media_dir = str(p)
                    break
                elif p.parent.is_dir():
                    state.media_dir = str(p.parent)
                    break

    agent = ReActAgent()

    try:
        response_text = await agent.run(req.message, state)
    except Exception as e:
        logger.exception("Agent error")
        response_text = f"Sorry, an error occurred: {str(e)}"

    return ChatResponse(message=response_text)
