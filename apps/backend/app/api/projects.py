import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.timeline import TimelineProject, migrate_project_data
from app.services.ws_manager import ws_manager

router = APIRouter()


def _projects_dir() -> Path:
    d = Path(settings.projects_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("")
async def create_project(name: str = "Untitled"):
    """Create a new empty project."""
    project_id = f"proj_{int.from_bytes(os.urandom(4), 'big')}"
    timeline = TimelineProject(
        version="1.0.0",
        project={"name": name, "width": 1920, "height": 1080, "fps": 30},
        media_pool=[],
        tracks=[],
    )
    path = _projects_dir() / f"{project_id}.json"
    path.write_text(timeline.model_dump_json(indent=2))
    return {"project_id": project_id, "timeline": timeline.model_dump()}


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get current Timeline JSON for a project.

    Reads from in-memory state if available, falls back to disk.
    """
    from app.api.chat import get_or_create_state

    state = get_or_create_state(project_id)
    if state.current_timeline:
        return {
            "project_id": project_id,
            "timeline": state.current_timeline.model_dump(),
            "version": state.version,
        }

    # Fallback: disk only (project exists but has no timeline in memory yet)
    path = _projects_dir() / f"{project_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    data = migrate_project_data(json.loads(path.read_text()))
    return {"project_id": project_id, "timeline": data, "version": 0}


@router.put("/{project_id}/timeline")
async def update_timeline(project_id: str, timeline: TimelineProject):
    """Update Timeline JSON for a project.

    Routes through in-memory state to prevent dual-writer conflicts.
    Rejects updates while the agent is actively processing.
    """
    from app.api.chat import get_or_create_state

    path = _projects_dir() / f"{project_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    state = get_or_create_state(project_id)

    if state.agent_active:
        raise HTTPException(
            status_code=409,
            detail="Agent is currently modifying the timeline. Please wait.",
        )

    # Update in-memory state (single source of truth)
    state.current_timeline = timeline
    version = state.bump_version()

    # Persist to disk
    path.write_text(timeline.model_dump_json(indent=2))

    # Broadcast to all connected clients
    await ws_manager.broadcast_timeline(
        project_id, timeline.model_dump(), version=version,
    )

    return {"project_id": project_id, "version": version}
