from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.ws_manager import ws_manager

router = APIRouter()


@router.websocket("/ws/timeline")
async def timeline_ws(websocket: WebSocket, project_id: str = "default"):
    """WebSocket endpoint for real-time timeline updates."""
    await ws_manager.connect(project_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Client messages (ack, seek, etc.) can be handled here
    except WebSocketDisconnect:
        ws_manager.disconnect(project_id, websocket)
