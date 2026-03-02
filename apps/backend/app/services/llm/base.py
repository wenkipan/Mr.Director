"""Abstract base class for LLM providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any]


@dataclass
class LLMResponse:
    text: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    reasoning_content: str | None = None


class LLMProvider(ABC):
    @abstractmethod
    async def generate(
        self,
        messages: list[dict],
        system_prompt: str,
        tools: list[dict],
        temperature: float = 0.7,
    ) -> LLMResponse:
        """Generate a response from the LLM.

        Args:
            messages: Conversation history in unified format:
                - {"role": "user", "content": "..."}
                - {"role": "assistant", "content": "..."}
                - {"role": "assistant", "tool_calls": [{"name": "...", "args": {...}}]}
                - {"role": "tool", "name": "...", "content": {...}}
            system_prompt: System instruction text.
            tools: Tool definitions from registry (name, description, parameters).
            temperature: Sampling temperature.

        Returns:
            LLMResponse with text and/or tool_calls.
        """
        ...
