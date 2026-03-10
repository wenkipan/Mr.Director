"""Chat API endpoint — bridges user messages to the ReAct Agent."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter

from app.agent.loop import ReActAgent
from app.config import settings
from app.models.messages import ChatRequest, ChatResponse
from app.services.timeline_manager import timeline_manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/chat")
async def chat_message(req: ChatRequest) -> ChatResponse:
    """Send a user message to the agent and get a response."""
    state = timeline_manager.get_state(req.project_id)

    # Sync from disk so agent always sees latest frontend edits
    timeline_manager.sync_from_disk(req.project_id)

    # If user mentions a directory, remember it as the media dir
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
