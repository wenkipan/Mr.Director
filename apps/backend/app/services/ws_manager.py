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

    async def broadcast_timeline(self, project_id: str, timeline_data: dict):
        message = {
            "type": "timeline_update",
            "data": timeline_data,
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
