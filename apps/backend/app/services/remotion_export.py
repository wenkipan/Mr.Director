import asyncio
import json
import logging
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import quote

from app.config import settings
from app.models.timeline import TimelineProject
from app.services.export_jobs import update_job
from app.services.gpu_check import check_gpu
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

# Resolve the frontend directory (relative to this file)
_THIS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _THIS_DIR.parent.parent  # apps/backend
_FRONTEND_DIR = _BACKEND_DIR.parent / "frontend"  # apps/frontend
_REMOTION_ENTRY = _FRONTEND_DIR / "src" / "remotion" / "index.ts"

# Backend media endpoint base URL (backend runs on port 8000)
_BACKEND_MEDIA_URL = "http://localhost:8000/api/media/file?path="


def _prepare_props(timeline: TimelineProject) -> dict:
    """
    Prepare the timeline props for Remotion render.
    - Rewrite media paths to HTTP URLs pointing to the running backend's
      media endpoint so Remotion's headless Chrome can fetch them.
    - Inline SRT file contents into subtitle clips (_srt_content field).
    """
    data = timeline.model_dump()

    # Mark as SSR mode so frontend resolveMediaUrl returns path as-is
    data["_ssr"] = True

    # Resolve media paths to absolute first
    for asset in data.get("media_pool", []):
        p = asset.get("path", "")
        if p and not p.startswith("/"):
            resolved = Path(p).resolve()
            if resolved.exists():
                asset["path"] = str(resolved)

    # Build a lookup: media_id -> asset (before path rewriting)
    media_map = {a["id"]: a for a in data.get("media_pool", [])}

    # Inline SRT content for subtitle clips (must happen before path rewriting)
    for track in data.get("tracks", []):
        if track.get("type") != "subtitle":
            continue
        for clip in track.get("clips", []):
            media_id = clip.get("media_id")
            if not media_id or clip.get("subtitle_text"):
                continue
            asset = media_map.get(media_id)
            if not asset:
                continue
            srt_path = Path(asset["path"])
            if srt_path.exists() and srt_path.suffix.lower() == ".srt":
                try:
                    clip["_srt_content"] = srt_path.read_text(encoding="utf-8")
                except Exception as e:
                    logger.warning(f"Failed to read SRT file {srt_path}: {e}")

    # Rewrite media paths to HTTP URLs served by the backend
    for asset in data.get("media_pool", []):
        abs_path = asset.get("path", "")
        if abs_path and not abs_path.startswith("http"):
            asset["path"] = f"{_BACKEND_MEDIA_URL}{quote(abs_path)}"

    return {"timeline": data}


async def run_remotion_export(
    export_id: str,
    project_id: str,
    timeline: TimelineProject,
    output_path: str,
) -> None:
    """
    Render an MP4 using Remotion CLI (npx remotion render).
    This produces pixel-perfect output matching the browser preview.
    """
    # Resolve output_path to absolute since Remotion runs with cwd=frontend
    output_path = str(Path(output_path).resolve())

    update_job(export_id, status="rendering", progress=0.0)
    await ws_manager.broadcast_export_progress(project_id, export_id, 0.0, "rendering")

    props_file = None
    try:
        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Prepare props JSON
        props = _prepare_props(timeline)
        props_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, prefix="remotion_props_"
        )
        json.dump(props, props_file, ensure_ascii=False)
        props_file.close()

        # Determine GL backend
        if settings.export_gl in ("auto", ""):
            gpu = check_gpu()
            gl_flag = gpu.gl_flag
        else:
            gl_flag = settings.export_gl

        # Build the remotion render command
        cmd = [
            "npx", "remotion", "render",
            str(_REMOTION_ENTRY),
            "MrDV2Export",
            output_path,
            "--props", props_file.name,
            "--codec", "h264",
            "--color-space", "bt709",
            "--gl", gl_flag,
            "--log", "verbose",
        ]

        logger.info(f"Remotion render command: {' '.join(cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(_FRONTEND_DIR),
        )

        # Parse progress from stderr
        # Remotion outputs lines like: "ℹ 30/900 frames rendered" or progress percentages
        total_frames = None
        async for raw_line in proc.stderr:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            logger.debug(f"[remotion] {line}")

            # Try to extract progress: "X/Y frames rendered"
            m = re.search(r"(\d+)/(\d+)\s+frames?\s+rendered", line, re.IGNORECASE)
            if m:
                rendered = int(m.group(1))
                total = int(m.group(2))
                total_frames = total
                progress = rendered / total if total > 0 else 0.0
                update_job(export_id, progress=progress)
                await ws_manager.broadcast_export_progress(
                    project_id, export_id, progress, "rendering"
                )
                continue

            # Alternative: percentage pattern "XX%"
            m2 = re.search(r"(\d+)%", line)
            if m2:
                progress = int(m2.group(1)) / 100.0
                update_job(export_id, progress=progress)
                await ws_manager.broadcast_export_progress(
                    project_id, export_id, progress, "rendering"
                )

        # Also consume stdout
        stdout_data, _ = await proc.communicate()

        if proc.returncode != 0:
            error_msg = f"Remotion render failed with exit code {proc.returncode}"
            logger.error(error_msg)
            update_job(export_id, status="error", error=error_msg)
            await ws_manager.broadcast_export_progress(project_id, export_id, 0.0, "error")
            return

        if not Path(output_path).exists():
            error_msg = "Remotion render completed but output file not found"
            logger.error(error_msg)
            update_job(export_id, status="error", error=error_msg)
            await ws_manager.broadcast_export_progress(project_id, export_id, 0.0, "error")
            return

        update_job(export_id, status="completed", progress=1.0)
        await ws_manager.broadcast_export_progress(project_id, export_id, 1.0, "completed")
        logger.info(f"Remotion export completed: {output_path}")

    except Exception as e:
        error_msg = f"Remotion export error: {e}"
        logger.exception(error_msg)
        update_job(export_id, status="error", error=error_msg)
        await ws_manager.broadcast_export_progress(project_id, export_id, 0.0, "error")
    finally:
        if props_file and os.path.exists(props_file.name):
            try:
                os.unlink(props_file.name)
            except OSError:
                pass
