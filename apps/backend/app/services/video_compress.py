"""Compress video files via ffmpeg for analysis upload."""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


async def compress_for_analysis(video_path: Path) -> Path:
    """Compress a video to 720p for sending to the LLM.

    Returns the path to a temporary compressed file.
    The caller is responsible for deleting it when done.
    """
    suffix = video_path.suffix or ".mp4"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()
    out_path = Path(tmp.name)

    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", "scale=-2:720",
        "-c:v", "libx264", "-preset", "fast", "-crf", "28",
        "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        str(out_path),
    ]

    logger.info("Compressing video: %s -> %s", video_path.name, out_path.name)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        out_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"ffmpeg compression failed (exit {proc.returncode}): "
            f"{stderr.decode(errors='replace')[:500]}"
        )

    orig_mb = video_path.stat().st_size / 1024 / 1024
    comp_mb = out_path.stat().st_size / 1024 / 1024
    logger.info("Compressed %.1fMB -> %.1fMB", orig_mb, comp_mb)
    return out_path
