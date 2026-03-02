"""OpenAI-compatible LLM provider implementation.

Works with any API that implements the OpenAI chat completions format:
OpenAI, DeepSeek, Qwen, Groq, Together AI, OpenRouter, Ollama, vLLM, etc.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI

from app.services.llm.base import LLMProvider, LLMResponse, ToolCall

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schema type normalization: Gemini uppercase -> JSON Schema lowercase
# ---------------------------------------------------------------------------

_TYPE_MAP = {
    "STRING": "string",
    "INTEGER": "integer",
    "NUMBER": "number",
    "BOOLEAN": "boolean",
    "ARRAY": "array",
    "OBJECT": "object",
}


def _normalize_schema(schema: dict) -> dict:
    """Recursively convert Gemini-style uppercase types to standard JSON Schema."""
    out: dict = {}
    for key, value in schema.items():
        if key == "type" and isinstance(value, str):
            out[key] = _TYPE_MAP.get(value, value.lower())
        elif isinstance(value, dict):
            out[key] = _normalize_schema(value)
        elif isinstance(value, list):
            out[key] = [_normalize_schema(v) if isinstance(v, dict) else v for v in value]
        else:
            out[key] = value
    return out


# ---------------------------------------------------------------------------
# Message format conversion: unified -> OpenAI
# ---------------------------------------------------------------------------

def _to_openai_messages(
    messages: list[dict], system_prompt: str
) -> list[dict]:
    """Convert unified message format to OpenAI messages."""
    oai_messages: list[dict] = [{"role": "system", "content": system_prompt}]

    for msg in messages:
        role = msg["role"]

        if role == "user":
            oai_messages.append({"role": "user", "content": msg["content"]})

        elif role == "assistant":
            if "tool_calls" in msg:
                oai_msg: dict[str, Any] = {"role": "assistant", "content": None}
                oai_msg["tool_calls"] = [
                    {
                        "id": f"call_{i}_{tc['name']}",
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["args"], ensure_ascii=False),
                        },
                    }
                    for i, tc in enumerate(msg["tool_calls"])
                ]
                if msg.get("reasoning_content"):
                    oai_msg["reasoning_content"] = msg["reasoning_content"]
                oai_messages.append(oai_msg)
            else:
                oai_msg = {"role": "assistant", "content": msg.get("content", "")}
                if msg.get("reasoning_content"):
                    oai_msg["reasoning_content"] = msg["reasoning_content"]
                oai_messages.append(oai_msg)

        elif role == "tool":
            # Find matching tool_call_id from previous assistant message
            tool_call_id = _find_tool_call_id(oai_messages, msg["name"])
            oai_messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": json.dumps(msg["content"], ensure_ascii=False)
                if isinstance(msg["content"], dict)
                else str(msg["content"]),
            })

    return oai_messages


def _find_tool_call_id(oai_messages: list[dict], tool_name: str) -> str:
    """Walk backwards to find the tool_call_id for a given tool name."""
    for msg in reversed(oai_messages):
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                if tc["function"]["name"] == tool_name:
                    return tc["id"]
    return f"call_{tool_name}"


# ---------------------------------------------------------------------------
# Tool format conversion: registry defs -> OpenAI tools
# ---------------------------------------------------------------------------

def _to_openai_tools(tool_defs: list[dict]) -> list[dict]:
    """Convert registry tool definitions to OpenAI function calling format."""
    return [
        {
            "type": "function",
            "function": {
                "name": td["name"],
                "description": td["description"],
                "parameters": _normalize_schema(td["parameters"]),
            },
        }
        for td in tool_defs
    ]


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class OpenAIProvider(LLMProvider):
    _THINKING_PARAMS: dict[str, dict] = {
        "dashscope": {"enable_thinking": True},
        "deepseek": {"thinking": {"type": "enabled"}},
    }

    def __init__(
        self, api_key: str, model: str, base_url: str | None = None,
        thinking: str = "off",
    ) -> None:
        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = AsyncOpenAI(**kwargs)
        self.model = model
        self.thinking = thinking

    async def generate(
        self,
        messages: list[dict],
        system_prompt: str,
        tools: list[dict],
        temperature: float = 0.7,
    ) -> LLMResponse:
        oai_messages = _to_openai_messages(messages, system_prompt)
        oai_tools = _to_openai_tools(tools)

        tool_names = [t["function"]["name"] for t in oai_tools]
        logger.info(f"Sending {len(oai_tools)} tools to {self.model}: {tool_names}")

        create_kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": oai_messages,
            "tools": oai_tools if oai_tools else None,
            "temperature": temperature,
        }
        extra_body = self._THINKING_PARAMS.get(self.thinking)
        if extra_body:
            create_kwargs["extra_body"] = extra_body

        response = await self.client.chat.completions.create(**create_kwargs)

        choice = response.choices[0]
        message = choice.message

        # Parse response
        text = message.content
        reasoning_content = getattr(message, "reasoning_content", None)
        tool_calls: list[ToolCall] = []

        if message.tool_calls:
            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                tool_calls.append(ToolCall(name=tc.function.name, args=args))

        return LLMResponse(text=text, tool_calls=tool_calls, reasoning_content=reasoning_content)
