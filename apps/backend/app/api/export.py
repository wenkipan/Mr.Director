import asyncio
import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from app.models.timeline import TimelineProject
from app.services.export_jobs import create_job, get_job
from app.services.ffmpeg_export import run_export

router = APIRouter()


class ExportRequest(BaseModel):
    project_id: str
    format: str = "mp4"


def _exports_dir() -> Path:
    d = Path(settings.exports_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _projects_dir() -> Path:
    d = Path(settings.projects_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("")
async def start_export(req: ExportRequest):
    """Start a video export job."""
    # Load timeline
    project_path = _projects_dir() / f"{req.project_id}.json"
    if not project_path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {req.project_id}")

    data = json.loads(project_path.read_text())
    timeline = TimelineProject(**data)

    if not timeline.tracks:
        raise HTTPException(status_code=400, detail="Timeline has no tracks to export")

    # Create export job
    export_id = f"exp_{int.from_bytes(os.urandom(4), 'big')}"
    output_path = str(_exports_dir() / f"{export_id}.{req.format}")

    job = create_job(export_id, req.project_id, output_path)

    # Launch background render
    asyncio.create_task(run_export(export_id, req.project_id, timeline, output_path))

    return {"export_id": export_id, "status": job.status}


@router.get("/{export_id}/status")
async def export_status(export_id: str):
    """Get the status of an export job."""
    job = get_job(export_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Export job not found: {export_id}")

    return {
        "export_id": job.export_id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
    }


@router.get("/{export_id}/download")
async def download_export(export_id: str):
    """Download the exported video file."""
    job = get_job(export_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Export job not found: {export_id}")

    if job.status != "completed":
        raise HTTPException(status_code=400, detail=f"Export not ready, status: {job.status}")

    output_path = Path(job.output_path)
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")

    filename = f"{job.project_id}_export{output_path.suffix}"
    return FileResponse(
        path=str(output_path),
        filename=filename,
        media_type="video/mp4",
    )
