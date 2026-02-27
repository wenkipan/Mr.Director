"""Tool registry for the ReAct agent. Decorator-based registration that
provides tool definitions in a provider-agnostic format."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Awaitable


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

    def as_tool_defs(self) -> list[dict]:
        """Return all registered tools as plain dicts (provider-agnostic)."""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            }
            for tool in self._tools.values()
        ]

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
