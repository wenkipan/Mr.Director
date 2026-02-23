"""ReAct Agent main loop — Gemini with function calling."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from google.genai.types import (
    Content,
    GenerateContentConfig,
    Part,
    FunctionCallingConfig,
    ToolConfig,
)

from app.agent.state import AgentState
from app.agent.prompt import build_system_prompt
from app.config import settings
from app.services.gemini_client import get_client
from app.services.ws_manager import ws_manager
from app.tools.registry import registry

# Import all tool modules so decorators register them
import app.tools.filesystem  # noqa: F401
import app.tools.shell  # noqa: F401
import app.tools.timeline_ops  # noqa: F401
import app.tools.user_interaction  # noqa: F401
import app.tools.gemini_vision  # noqa: F401
import app.tools.asr  # noqa: F401
import app.tools.subtitles  # noqa: F401

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 20
TIMELINE_MODIFYING_TOOLS = {"create_timeline", "modify_timeline", "generate_subtitles"}
# Tools that require user interaction — agent loop must stop and return the message
USER_FACING_TOOLS = {"ask_user", "present_plan"}


class ReActAgent:
    def __init__(self):
        self.client = get_client()

    async def run(self, user_message: str, state: AgentState) -> str:
        """Run the agent loop. Returns the agent's final text response."""

        # Add user message to conversation history
        state.conversation_history.append({
            "role": "user",
            "parts": [{"text": user_message}],
        })

        system_prompt = build_system_prompt(state)

        for iteration in range(MAX_ITERATIONS):
            logger.info(f"Agent iteration {iteration + 1}/{MAX_ITERATIONS}")

            # Build contents for Gemini
            contents = [
                Content(role=msg["role"], parts=[Part.from_text(text=p["text"]) if "text" in p else Part(function_call=p.get("function_call")) if "function_call" in p else Part(function_response=p.get("function_response")) for p in msg["parts"]])
                for msg in state.conversation_history
            ]

            try:
                response = self.client.models.generate_content(
                    model=settings.gemini_model,
                    contents=contents,
                    config=GenerateContentConfig(
                        system_instruction=system_prompt,
                        tools=registry.as_gemini_tools(),
                        tool_config=ToolConfig(
                            function_calling_config=FunctionCallingConfig(
                                mode="AUTO"
                            )
                        ),
                        temperature=0.7,
                    ),
                )
            except Exception as e:
                logger.error(f"Gemini API error: {e}")
                return f"Sorry, I encountered an error communicating with the AI model: {str(e)}"

            if not response.candidates:
                return "Sorry, I didn't get a valid response. Please try again."

            candidate = response.candidates[0]
            if not candidate.content or not candidate.content.parts:
                return "Sorry, I received an empty response. Please try again."

            # Process response parts
            has_function_call = False
            should_stop = False
            stop_text = ""
            text_parts = []

            for part in candidate.content.parts:
                if part.function_call:
                    has_function_call = True
                    tool_name = part.function_call.name
                    tool_args = dict(part.function_call.args) if part.function_call.args else {}

                    logger.info(f"Tool call: {tool_name}({json.dumps(tool_args, ensure_ascii=False)[:200]})")

                    # Broadcast thinking status
                    await ws_manager.broadcast_agent_thinking(state.project_id, tool_name)

                    # Execute the tool
                    result = await registry.execute(tool_name, tool_args, state)

                    logger.info(f"Tool result: {json.dumps(result, ensure_ascii=False)[:200]}")

                    # Add function call to history
                    state.conversation_history.append({
                        "role": "model",
                        "parts": [{"function_call": {"name": tool_name, "args": tool_args}}],
                    })

                    # Add function response to history
                    state.conversation_history.append({
                        "role": "user",
                        "parts": [{"function_response": {"name": tool_name, "response": result}}],
                    })

                    # If timeline was modified, push update via WebSocket
                    if tool_name in TIMELINE_MODIFYING_TOOLS and state.current_timeline:
                        await ws_manager.broadcast_timeline(
                            state.project_id,
                            state.current_timeline.model_dump(),
                        )
                        # Also save to disk
                        _save_timeline(state)

                    # User-facing tools: stop the loop and return the message
                    if tool_name in USER_FACING_TOOLS:
                        should_stop = True
                        stop_text = tool_args.get("question") or tool_args.get("summary") or ""

                elif part.text:
                    text_parts.append(part.text)

            # If a user-facing tool was called, return its message to the user
            if should_stop:
                final_text = "\n".join(text_parts) if text_parts else stop_text
                state.conversation_history.append({
                    "role": "model",
                    "parts": [{"text": final_text}],
                })
                return final_text

            # If there were function calls, continue the loop
            if has_function_call:
                continue

            # If we only got text, the agent is done
            if text_parts:
                final_text = "\n".join(text_parts)
                state.conversation_history.append({
                    "role": "model",
                    "parts": [{"text": final_text}],
                })
                return final_text

        return "I've reached the maximum number of reasoning steps. Please try breaking your request into smaller parts."


def _save_timeline(state: AgentState):
    """Save current timeline to disk."""
    if not state.current_timeline:
        return
    projects_dir = Path(settings.projects_dir)
    projects_dir.mkdir(parents=True, exist_ok=True)
    path = projects_dir / f"{state.project_id}.json"
    path.write_text(state.current_timeline.model_dump_json(indent=2))
