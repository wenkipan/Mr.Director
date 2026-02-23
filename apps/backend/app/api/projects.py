import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.timeline import TimelineProject

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
    """Get current Timeline JSON for a project."""
    path = _projects_dir() / f"{project_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    data = json.loads(path.read_text())
    return {"project_id": project_id, "timeline": data}


@router.put("/{project_id}/timeline")
async def update_timeline(project_id: str, timeline: TimelineProject):
    """Update Timeline JSON for a project."""
    path = _projects_dir() / f"{project_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    path.write_text(timeline.model_dump_json(indent=2))
    return {"project_id": project_id, "timeline": timeline.model_dump()}
