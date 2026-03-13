"""Export tool: lets the agent trigger timeline exports."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Literal

from app.config import settings
from app.tools.registry import registry


def _exports_dir() -> Path:
    d = Path(settings.exports_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


@registry.register(
    name="export_timeline",
    description=(
        "Export the current timeline to a file. "
        "Interchange formats (otio, fcpxml) complete instantly and return a download link. "
        "Video formats (mp4, h264) are submitted as background jobs — "
        "the user tracks progress and downloads from the UI export panel. "
        "\n\nWhen to use: user asks to export, render, download, or share the project. "
        "When NOT to use: user is still editing — finish the edit first."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "format": {
                "type": "STRING",
                "description": (
                    "Export format: "
                    "'otio' or 'fcpxml' for NLE interchange (DaVinci, Premiere, etc.); "
                    "'h264' for fast FFmpeg render; "
                    "'mp4' for Remotion browser render (highest fidelity)."
                ),
            },
            "include_srt": {
                "type": "BOOLEAN",
                "description": "Whether to also generate a companion SRT subtitle file. Defaults to true.",
            },
            "subtitle_burn_in": {
                "type": "STRING",
                "description": (
                    "Subtitle burn-in mode for h264 only: 'ass' (styled), 'srt' (plain), or 'none'. "
                    "Defaults to 'ass'."
                ),
            },
        },
        "required": ["format"],
    },
)
async def export_timeline(args: dict, state) -> dict:
    from app.services.export_jobs import create_job, update_job
    from app.services.otio_export import export_otio_file
    from app.services.fcpxml_export import export_fcpxml_file
    from app.services.srt_export import generate_srt_string
    from app.services.remotion_export import run_remotion_export
    from app.services.ffmpeg_export import run_ffmpeg_export

    fmt: str = args.get("format", "mp4")
    if fmt not in ("mp4", "h264", "otio", "fcpxml"):
        return {"error": f"Unsupported format: {fmt!r}. Choose from: mp4, h264, otio, fcpxml"}

    include_srt: bool = args.get("include_srt", True)
    subtitle_burn_in: str = args.get("subtitle_burn_in", "ass")

    timeline = state.current_timeline
    if timeline is None:
        return {"error": "No timeline loaded for this project."}
    if not timeline.tracks:
        return {"error": "Timeline has no tracks to export."}

    export_id = f"exp_{int.from_bytes(os.urandom(4), 'big')}"
    exports_dir = _exports_dir()

    # ── Synchronous interchange formats ──────────────────────
    if fmt in ("otio", "fcpxml"):
        suffix = ".otio" if fmt == "otio" else ".fcpxml"
        output_path = str(exports_dir / f"{export_id}{suffix}")

        if fmt == "otio":
            export_otio_file(timeline, output_path)
        else:
            export_fcpxml_file(timeline, output_path)

        # Register as a completed job so /api/export/{id}/download works
        job = create_job(export_id, state.project_id, output_path)
        update_job(export_id, status="completed", progress=1.0)

        srt_available = False
        if include_srt:
            srt_content = generate_srt_string(timeline)
            if srt_content:
                srt_path = exports_dir / f"{export_id}.srt"
                srt_path.write_text(srt_content, encoding="utf-8")
                srt_available = True

        result = {
            "export_id": export_id,
            "format": fmt,
            "status": "completed",
            "download_path": f"/api/export/{export_id}/download",
            "srt_available": srt_available,
            "message": f"{fmt.upper()} export ready. The user can download it from the export panel.",
        }
        if srt_available:
            result["srt_path"] = f"/api/export/{export_id}/srt"
        return result

    # ── Async video export ────────────────────────────────────
    output_path = str(exports_dir / f"{export_id}.mp4")
    job = create_job(export_id, state.project_id, output_path)

    if fmt == "h264":
        asyncio.create_task(
            run_ffmpeg_export(export_id, state.project_id, timeline, output_path, subtitle_burn_in)
        )
    else:
        asyncio.create_task(
            run_remotion_export(export_id, state.project_id, timeline, output_path)
        )

    return {
        "export_id": export_id,
        "format": fmt,
        "status": "queued",
        "message": (
            f"{fmt.upper()} render job submitted (id: {export_id}). "
            "The user can track progress and download the file from the export panel in the UI."
        ),
    }
