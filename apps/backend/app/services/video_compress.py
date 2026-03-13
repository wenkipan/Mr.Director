"""Compress video files via ffmpeg for analysis upload."""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# base64 膨胀 ~33%，代理缓冲上限 50MB → 原始文件需 < 37MB
MAX_SIZE_MB = 37


def _pick_compress_params(file_size_mb: float) -> tuple[int, int, str]:
    """根据原始文件大小选择压缩参数: (分辨率高度, CRF, 音频码率)。"""
    if file_size_mb <= MAX_SIZE_MB:
        return (720, 28, "64k")
    elif file_size_mb <= 100:
        return (720, 33, "48k")
    elif file_size_mb <= 300:
        return (480, 32, "48k")
    elif file_size_mb <= 800:
        return (480, 38, "32k")
    else:
        return (360, 35, "32k")


async def compress_for_analysis(video_path: Path) -> Path:
    """Compress a video for sending to the LLM, ensuring output < MAX_SIZE_MB.

    Picks compression parameters based on the original file size.
    Returns the path to a temporary compressed file.
    The caller is responsible for deleting it when done.
    """
    suffix = video_path.suffix or ".mp4"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()
    out_path = Path(tmp.name)

    orig_mb = video_path.stat().st_size / 1024 / 1024
    height, crf, audio_br = _pick_compress_params(orig_mb)

    logger.info(
        "Compressing video: %s (%.1fMB) -> %dp crf=%d abr=%s",
        video_path.name, orig_mb, height, crf, audio_br,
    )

    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", f"scale=-2:{height}",
        "-c:v", "libx264", "-preset", "fast", "-crf", str(crf),
        "-c:a", "aac", "-b:a", audio_br,
        "-movflags", "+faststart",
        str(out_path),
    ]

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

    comp_mb = out_path.stat().st_size / 1024 / 1024
    logger.info("Compressed %.1fMB -> %.1fMB", orig_mb, comp_mb)
    return out_path
