import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.ws_manager import ws_manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/timeline")
async def timeline_ws(websocket: WebSocket, project_id: str = "default"):
    """WebSocket endpoint for real-time timeline updates."""
    await ws_manager.connect(project_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "abort_agent":
                    from app.services.timeline_manager import timeline_manager

                    target_project = msg.get("project_id", project_id)
                    state = timeline_manager.get_state(target_project)
                    if state.agent_active:
                        state.abort_requested = True
                        logger.info(f"Abort requested for project {target_project}")
            except (json.JSONDecodeError, KeyError):
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(project_id, websocket)
