"""Gemini LLM provider implementation."""

from __future__ import annotations

import logging
from typing import Any

from google import genai
from google.genai.types import (
    Content,
    FunctionCallingConfig,
    FunctionDeclaration,
    GenerateContentConfig,
    Part,
    Tool,
    ToolConfig,
)

from app.config import settings
from app.services.llm.base import LLMProvider, LLMResponse, ToolCall

logger = logging.getLogger(__name__)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        kwargs: dict = {"api_key": settings.gemini_api_key}
        if settings.gemini_base_url:
            kwargs["http_options"] = {"base_url": settings.gemini_base_url}
        _client = genai.Client(**kwargs)
    return _client


# ---------------------------------------------------------------------------
# Message format conversion: unified -> Gemini
# ---------------------------------------------------------------------------

def _to_gemini_contents(messages: list[dict]) -> list[Content]:
    """Convert unified message format to Gemini Content objects."""
    contents: list[Content] = []
    for msg in messages:
        role = msg["role"]

        if role == "user":
            contents.append(
                Content(role="user", parts=[Part.from_text(text=msg["content"])])
            )

        elif role == "assistant":
            if "tool_calls" in msg:
                parts = [
                    Part(function_call={"name": tc["name"], "args": tc["args"]})
                    for tc in msg["tool_calls"]
                ]
                contents.append(Content(role="model", parts=parts))
            else:
                contents.append(
                    Content(role="model", parts=[Part.from_text(text=msg.get("content", ""))])
                )

        elif role == "tool":
            contents.append(
                Content(
                    role="user",
                    parts=[
                        Part(function_response={"name": msg["name"], "response": msg["content"]})
                    ],
                )
            )

    return contents


# ---------------------------------------------------------------------------
# Tool format conversion: registry defs -> Gemini Tool
# ---------------------------------------------------------------------------

def _to_gemini_tools(tool_defs: list[dict]) -> list[Tool]:
    """Convert registry tool definitions to Gemini Tool format."""
    declarations = [
        FunctionDeclaration(
            name=td["name"],
            description=td["description"],
            parameters=td["parameters"],
        )
        for td in tool_defs
    ]
    return [Tool(function_declarations=declarations)]


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class GeminiProvider(LLMProvider):
    def __init__(self) -> None:
        self.client = _get_client()

    async def generate(
        self,
        messages: list[dict],
        system_prompt: str,
        tools: list[dict],
        temperature: float = 0.7,
    ) -> LLMResponse:
        contents = _to_gemini_contents(messages)
        gemini_tools = _to_gemini_tools(tools)

        response = self.client.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=GenerateContentConfig(
                system_instruction=system_prompt,
                tools=gemini_tools,
                tool_config=ToolConfig(
                    function_calling_config=FunctionCallingConfig(mode="AUTO")
                ),
                temperature=temperature,
            ),
        )

        # Parse response
        if not response.candidates:
            return LLMResponse(text="Sorry, I didn't get a valid response. Please try again.")

        candidate = response.candidates[0]
        if not candidate.content or not candidate.content.parts:
            return LLMResponse(text="Sorry, I received an empty response. Please try again.")

        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []

        for part in candidate.content.parts:
            if part.function_call:
                tool_calls.append(
                    ToolCall(
                        name=part.function_call.name,
                        args=dict(part.function_call.args) if part.function_call.args else {},
                    )
                )
            elif part.text:
                text_parts.append(part.text)

        return LLMResponse(
            text="\n".join(text_parts) if text_parts else None,
            tool_calls=tool_calls,
        )
