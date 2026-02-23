"""Tool registry for the ReAct agent. Decorator-based registration that
auto-generates Gemini function declarations."""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

from google.genai.types import FunctionDeclaration, Schema, Tool


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Awaitable[dict]]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDef] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
    ):
        """Decorator for registering agent tools."""

        def decorator(func: Callable[..., Awaitable[dict]]):
            self._tools[name] = ToolDef(
                name=name,
                description=description,
                parameters=parameters,
                handler=func,
            )
            return func

        return decorator

    def as_gemini_tools(self) -> list[Tool]:
        """Convert all registered tools to Gemini Tool format."""
        declarations = []
        for tool in self._tools.values():
            declarations.append(
                FunctionDeclaration(
                    name=tool.name,
                    description=tool.description,
                    parameters=tool.parameters,
                )
            )
        return [Tool(function_declarations=declarations)]

    async def execute(self, name: str, args: dict, state: Any) -> dict:
        if name not in self._tools:
            return {"error": f"Unknown tool: {name}"}
        handler = self._tools[name].handler
        try:
            return await handler(args, state)
        except Exception as e:
            return {"error": f"Tool '{name}' failed: {str(e)}"}

    @property
    def tool_names(self) -> list[str]:
        return list(self._tools.keys())


# Global registry instance
registry = ToolRegistry()
