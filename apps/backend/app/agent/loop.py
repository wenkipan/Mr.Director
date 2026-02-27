"""ReAct Agent main loop — provider-agnostic LLM with function calling."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.agent.state import AgentState
from app.agent.prompt import build_system_prompt
from app.config import settings
from app.services.llm import get_provider
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
        self.provider = get_provider()

    async def run(self, user_message: str, state: AgentState) -> str:
        """Run the agent loop. Returns the agent's final text response."""

        # Add user message to conversation history (unified format)
        state.conversation_history.append({
            "role": "user",
            "content": user_message,
        })

        system_prompt = build_system_prompt(state)
        tool_defs = registry.as_tool_defs()

        for iteration in range(MAX_ITERATIONS):
            logger.info(f"Agent iteration {iteration + 1}/{MAX_ITERATIONS}")

            try:
                response = await self.provider.generate(
                    messages=state.conversation_history,
                    system_prompt=system_prompt,
                    tools=tool_defs,
                    temperature=0.7,
                )
            except Exception as e:
                logger.error(f"LLM API error: {e}")
                await ws_manager.broadcast_agent_progress(state.project_id, event="agent_done")
                return f"Sorry, I encountered an error communicating with the AI model: {str(e)}"

            # If no tool calls, the agent is done — return text
            if not response.tool_calls:
                final_text = response.text or "Sorry, I received an empty response. Please try again."
                state.conversation_history.append({
                    "role": "assistant",
                    "content": final_text,
                })
                await ws_manager.broadcast_agent_progress(state.project_id, event="agent_done")
                return final_text

            # Process tool calls
            should_stop = False
            stop_text = ""

            # Record all tool calls in one assistant message
            state.conversation_history.append({
                "role": "assistant",
                "tool_calls": [{"name": tc.name, "args": tc.args} for tc in response.tool_calls],
            })

            for tc in response.tool_calls:
                logger.info(f"Tool call: {tc.name}({json.dumps(tc.args, ensure_ascii=False)[:200]})")

                # Broadcast tool_start progress
                await ws_manager.broadcast_agent_progress(
                    state.project_id,
                    event="tool_start",
                    tool_name=tc.name,
                    tool_args=tc.args,
                    iteration=iteration + 1,
                )

                # Execute the tool
                result = await registry.execute(tc.name, tc.args, state)

                logger.info(f"Tool result: {json.dumps(result, ensure_ascii=False)[:200]}")

                # Broadcast tool_end progress
                is_error = "error" in result
                result_summary = json.dumps(result, ensure_ascii=False)[:300]
                await ws_manager.broadcast_agent_progress(
                    state.project_id,
                    event="tool_end",
                    tool_name=tc.name,
                    result_summary=result_summary,
                    is_error=is_error,
                    iteration=iteration + 1,
                )

                # Add tool result to history
                state.conversation_history.append({
                    "role": "tool",
                    "name": tc.name,
                    "content": result,
                })

                # If timeline was modified, push update via WebSocket
                if tc.name in TIMELINE_MODIFYING_TOOLS and state.current_timeline:
                    await ws_manager.broadcast_timeline(
                        state.project_id,
                        state.current_timeline.model_dump(),
                    )
                    _save_timeline(state)

                # User-facing tools: stop the loop and return the message
                if tc.name in USER_FACING_TOOLS:
                    should_stop = True
                    stop_text = tc.args.get("question") or tc.args.get("summary") or ""

            # If a user-facing tool was called, return its message to the user
            if should_stop:
                final_text = response.text or stop_text
                state.conversation_history.append({
                    "role": "assistant",
                    "content": final_text,
                })
                await ws_manager.broadcast_agent_progress(state.project_id, event="agent_done")
                return final_text

            # Continue the loop for the next iteration

        await ws_manager.broadcast_agent_progress(state.project_id, event="agent_done")
        return "I've reached the maximum number of reasoning steps. Please try breaking your request into smaller parts."


def _save_timeline(state: AgentState):
    """Save current timeline to disk."""
    if not state.current_timeline:
        return
    projects_dir = Path(settings.projects_dir)
    projects_dir.mkdir(parents=True, exist_ok=True)
    path = projects_dir / f"{state.project_id}.json"
    path.write_text(state.current_timeline.model_dump_json(indent=2))
