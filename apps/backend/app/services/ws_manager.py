import json
from datetime import datetime, timezone

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self):
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, project_id: str, ws: WebSocket):
        await ws.accept()
        self.connections.setdefault(project_id, []).append(ws)

    def disconnect(self, project_id: str, ws: WebSocket):
        conns = self.connections.get(project_id, [])
        if ws in conns:
            conns.remove(ws)

    async def broadcast_timeline(self, project_id: str, timeline_data: dict, version: int = 0):
        message = {
            "type": "timeline_update",
            "data": timeline_data,
            "version": version,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(project_id, message)

    async def broadcast_agent_message(self, project_id: str, text: str):
        message = {
            "type": "agent_message",
            "data": {"text": text},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(project_id, message)

    async def broadcast_agent_thinking(self, project_id: str, tool_name: str):
        message = {
            "type": "agent_thinking",
            "data": {"tool": tool_name},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(project_id, message)

    async def broadcast_agent_reasoning(self, project_id: str, reasoning: str):
        """Broadcast the model's reasoning/thinking content to connected clients."""
        message = {
            "type": "agent_reasoning",
            "data": {"reasoning": reasoning[:2000]},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(project_id, message)

    async def broadcast_agent_progress(
        self,
        project_id: str,
        event: str,
        tool_name: str = "",
        tool_args: dict | None = None,
        result_summary: str | None = None,
        is_error: bool = False,
        iteration: int = 0,
    ):
        data: dict = {"event": event, "iteration": iteration}
        if tool_name:
            data["tool_name"] = tool_name
        if tool_args is not None:
            safe_args = {}
            for k, v in tool_args.items():
                s = str(v)
                safe_args[k] = (s[:200] + "...") if len(s) > 200 else s
            data["tool_args"] = safe_args
        if result_summary is not None:
            data["result_summary"] = result_summary[:300]
        data["is_error"] = is_error

        message = {
            "type": "agent_progress",
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(project_id, message)

    async def broadcast_export_progress(
        self,
        project_id: str,
        export_id: str,
        progress: float,
        status: str = "rendering",
    ):
        message = {
            "type": "export_progress",
            "data": {
                "export_id": export_id,
                "progress": progress,
                "status": status,
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(project_id, message)

    async def _broadcast(self, project_id: str, message: dict):
        dead = []
        for ws in self.connections.get(project_id, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(project_id, ws)


ws_manager = WebSocketManager()
