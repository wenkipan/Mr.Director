import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.timeline import TimelineProject, migrate_project_data
from app.services.timeline_manager import timeline_manager

router = APIRouter()


def _projects_dir() -> Path:
    d = Path(settings.projects_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.get("")
async def list_projects():
    """List all projects with id and name."""
    results = []
    for f in sorted(_projects_dir().glob("proj_*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text())
            name = data.get("project", {}).get("name", "Untitled")
            results.append({"project_id": f.stem, "name": name})
        except (json.JSONDecodeError, OSError):
            continue
    return results


@router.post("")
async def create_project(name: str = "Untitled"):
    """Create a new empty project."""
    project_id = f"proj_{int.from_bytes(os.urandom(4), 'big')}"
    tl = TimelineProject(
        version="1.0.0",
        project={"name": name, "width": 1920, "height": 1080, "fps": 30},
        media_pool=[],
        tracks=[],
    )
    timeline_manager.create_project(project_id, tl)
    return {"project_id": project_id, "timeline": tl.model_dump()}


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get current Timeline JSON for a project."""
    if not timeline_manager.project_exists(project_id):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    state = timeline_manager.get_state(project_id)
    if state.current_timeline:
        return {
            "project_id": project_id,
            "timeline": state.current_timeline.model_dump(),
            "version": state.version,
        }

    # Fallback: disk only (project exists but not yet loaded — shouldn't happen
    # since get_state loads from disk, but just in case)
    path = _projects_dir() / f"{project_id}.json"
    data = migrate_project_data(json.loads(path.read_text()))
    return {"project_id": project_id, "timeline": data, "version": 0}


@router.put("/{project_id}/timeline")
async def update_timeline(project_id: str, timeline: TimelineProject):
    """Update Timeline JSON for a project.

    Routes through TimelineManager to prevent dual-writer conflicts.
    Rejects updates while the agent is actively processing.
    """
    if not timeline_manager.project_exists(project_id):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        version = await timeline_manager.update_from_frontend(project_id, timeline)
    except ValueError:
        raise HTTPException(
            status_code=409,
            detail="Agent is currently modifying the timeline. Please wait.",
        )

    return {"project_id": project_id, "version": version}
