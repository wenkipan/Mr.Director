import asyncio
import json
import os
from pathlib import Path

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from app.models.timeline import TimelineProject, migrate_project_data
from app.services.export_jobs import create_job, get_job
from app.services.gpu_check import check_gpu
from app.services.remotion_export import run_remotion_export
from app.services.ffmpeg_export import run_ffmpeg_export
from app.services.otio_export import export_otio_file
from app.services.fcpxml_export import export_fcpxml_file
from app.services.srt_export import generate_srt_string
from app.services.ass_export import generate_ass

router = APIRouter()

_MIME_TYPES: dict[str, str] = {
    ".mp4": "video/mp4",
    ".otio": "application/json",
    ".fcpxml": "application/xml",
    ".srt": "text/plain; charset=utf-8",
}


class ExportRequest(BaseModel):
    project_id: str
    format: str = "mp4"  # mp4 (Remotion), h264 (FFmpeg), otio, fcpxml
    include_srt: bool = True
    subtitle_burn_in: Literal["ass", "srt", "none"] = "ass"


def _exports_dir() -> Path:
    d = Path(settings.exports_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _projects_dir() -> Path:
    d = Path(settings.projects_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_timeline(project_id: str) -> TimelineProject:
    from app.services.timeline_manager import timeline_manager

    state = timeline_manager.get_state(project_id)
    if state.current_timeline:
        if not state.current_timeline.tracks:
            raise HTTPException(status_code=400, detail="Timeline has no tracks to export")
        return state.current_timeline

    # Fallback: disk (project not yet loaded into memory)
    project_path = _projects_dir() / f"{project_id}.json"
    if not project_path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    data = migrate_project_data(json.loads(project_path.read_text()))
    timeline = TimelineProject(**data)

    if not timeline.tracks:
        raise HTTPException(status_code=400, detail="Timeline has no tracks to export")
    return timeline


@router.get("/gpu-status")
async def gpu_status():
    """Pre-flight GPU availability check for Remotion rendering."""
    if settings.export_gl not in ("auto", ""):
        forced = settings.export_gl
        return {
            "gpu_available": forced in ("angle-egl", "egl", "vulkan", "angle"),
            "gl_flag": forced,
            "reason": f"Forced via MRDV2_EXPORT_GL={forced}",
        }
    status = check_gpu()
    return {
        "gpu_available": status.available,
        "gl_flag": status.gl_flag,
        "reason": status.reason,
    }


@router.post("")
async def start_export(req: ExportRequest):
    """Start an export. OTIO/FCPXML return files directly; MP4/h264 uses async job."""
    if req.format not in ("mp4", "h264", "otio", "fcpxml"):
        raise HTTPException(status_code=422, detail=f"Unsupported format: {req.format!r}")
    timeline = _load_timeline(req.project_id)
    export_id = f"exp_{int.from_bytes(os.urandom(4), 'big')}"
    exports_dir = _exports_dir()

    # ── Synchronous interchange formats ───────────────────────
    if req.format in ("otio", "fcpxml"):
        suffix = ".otio" if req.format == "otio" else ".fcpxml"
        output_path = str(exports_dir / f"{export_id}{suffix}")

        if req.format == "otio":
            export_otio_file(timeline, output_path)
        else:
            export_fcpxml_file(timeline, output_path)

        # Companion SRT
        srt_available = False
        if req.include_srt:
            srt_content = generate_srt_string(timeline)
            if srt_content:
                srt_path = exports_dir / f"{export_id}.srt"
                srt_path.write_text(srt_content, encoding="utf-8")
                srt_available = True

        filename = f"{req.project_id}_export{suffix}"
        media_type = _MIME_TYPES.get(suffix, "application/octet-stream")
        return FileResponse(
            path=output_path,
            filename=filename,
            media_type=media_type,
            headers={
                "X-SRT-Available": "true" if srt_available else "false",
                "X-Export-Id": export_id,
            },
        )

    # ── Async video export ────────────────────────────────────
    output_path = str(exports_dir / f"{export_id}.mp4")
    job = create_job(export_id, req.project_id, output_path)

    if req.format == "h264":
        asyncio.create_task(run_ffmpeg_export(export_id, req.project_id, timeline, output_path, req.subtitle_burn_in))
    else:
        asyncio.create_task(run_remotion_export(export_id, req.project_id, timeline, output_path))

    return {"export_id": export_id, "status": job.status}


@router.get("/ass/{project_id}")
async def download_ass(project_id: str):
    """Export and download ASS subtitle file for a project."""
    timeline = _load_timeline(project_id)
    exports_dir = _exports_dir()
    output_path = str(exports_dir / f"{project_id}_subtitles.ass")

    result = generate_ass(timeline, output_path)
    if result is None:
        raise HTTPException(status_code=404, detail="No subtitles found in timeline")

    return FileResponse(
        path=output_path,
        filename=f"{project_id}.ass",
        media_type="text/plain; charset=utf-8",
    )


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
    """Download the exported file."""
    job = get_job(export_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Export job not found: {export_id}")

    if job.status != "completed":
        raise HTTPException(status_code=400, detail=f"Export not ready, status: {job.status}")

    output_path = Path(job.output_path)
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")

    suffix = output_path.suffix.lower()
    media_type = _MIME_TYPES.get(suffix, "application/octet-stream")
    filename = f"{job.project_id}_export{suffix}"
    return FileResponse(path=str(output_path), filename=filename, media_type=media_type)


@router.get("/{export_id}/srt")
async def download_srt(export_id: str):
    """Download the companion SRT subtitle file for an interchange export."""
    srt_path = _exports_dir() / f"{export_id}.srt"
    if not srt_path.exists():
        raise HTTPException(status_code=404, detail="SRT file not found for this export")
    return FileResponse(
        path=str(srt_path),
        filename=f"{export_id}.srt",
        media_type="text/plain; charset=utf-8",
    )
