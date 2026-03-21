import os
import json
import struct
import hashlib
import mimetypes
import subprocess
from pathlib import Path

from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse

router = APIRouter()

# In-memory cache for waveform data (keyed by file path + mtime)
_waveform_cache: dict[str, dict] = {}

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi",
    ".mp3", ".wav", ".aac", ".flac", ".ogg",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg",
    ".srt", ".vtt",
}


@router.get("/list")
async def list_media(dir: str = Query(..., description="Directory path to list")):
    """List media files in a local directory."""
    dir_path = Path(dir).resolve()
    if not dir_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {dir}")

    files = []
    try:
        entries = sorted(dir_path.iterdir())
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied: {dir}")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot read directory: {e}")

    for entry in entries:
        try:
            if entry.is_file() and entry.suffix.lower() in ALLOWED_EXTENSIONS:
                stat = entry.stat()
                mime, _ = mimetypes.guess_type(str(entry))
                file_type = _classify(entry.suffix.lower())
                info = {
                    "name": entry.name,
                    "path": str(entry),
                    "size": stat.st_size,
                    "mime_type": mime,
                    "type": file_type,
                }
                if file_type in ("video", "audio"):
                    probed = _probe_media(str(entry))
                    if "duration" in probed:
                        info["duration"] = probed["duration"]
                    if "width" in probed:
                        info["width"] = probed["width"]
                    if "height" in probed:
                        info["height"] = probed["height"]
                files.append(info)
            elif entry.is_dir():
                files.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "directory",
                })
        except (PermissionError, OSError):
            continue

    return {"dir": str(dir_path), "files": files}


@router.get("/file")
async def serve_media_file(request: Request, path: str = Query(..., description="Absolute file path")):
    """Serve a local media file with HTTP Range support for video seeking."""
    file_path = Path(path).resolve()
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=403, detail="File type not allowed")

    mime, _ = mimetypes.guess_type(str(file_path))
    content_type = mime or "application/octet-stream"
    file_size = file_path.stat().st_size

    range_header = request.headers.get("range")
    if range_header:
        # Parse "bytes=start-end"
        range_spec = range_header.strip().lower()
        if range_spec.startswith("bytes="):
            range_spec = range_spec[6:]
        parts = range_spec.split("-", 1)
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_file():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )

    return FileResponse(
        path=str(file_path),
        media_type=content_type,
        filename=file_path.name,
        headers={"Accept-Ranges": "bytes"},
    )


def _classify(ext: str) -> str:
    if ext in {".mp4", ".mov", ".mkv", ".webm", ".avi"}:
        return "video"
    if ext in {".mp3", ".wav", ".aac", ".flac", ".ogg"}:
        return "audio"
    return "image"


def _probe_media(path: str) -> dict:
    """Probe media metadata via ffprobe. Returns dict with duration, width, height (when available)."""
    result_dict: dict = {}
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_format", "-show_streams",
                path,
            ],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return result_dict
        info = json.loads(result.stdout)
        dur = info.get("format", {}).get("duration")
        if dur is not None:
            result_dict["duration"] = float(dur)
        # Extract width/height from the first video stream
        for stream in info.get("streams", []):
            if stream.get("codec_type") == "video":
                w = stream.get("width")
                h = stream.get("height")
                if w and h:
                    result_dict["width"] = int(w)
                    result_dict["height"] = int(h)
                break
    except Exception:
        pass
    return result_dict


@router.get("/waveform")
async def get_waveform(
    path: str = Query(..., description="Absolute file path"),
    peaks_per_sec: int = Query(100, ge=10, le=500, description="Temporal resolution: peaks per second of audio"),
):
    """Generate audio waveform peaks at a fixed temporal resolution.

    Returns peaks at `peaks_per_sec` resolution (default 100 peaks/sec).
    The frontend slices by source range and downsamples to pixel width.
    Results are cached in memory keyed by file path + mtime.
    """
    file_path = Path(path).resolve()
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    ext = file_path.suffix.lower()
    if ext not in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".mp3", ".wav", ".aac", ".flac", ".ogg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type for waveform")

    mtime = file_path.stat().st_mtime
    cache_key = f"{file_path}:{mtime}:{peaks_per_sec}"
    if cache_key in _waveform_cache:
        cached = _waveform_cache[cache_key]
        return cached

    # Evict oldest entries if cache exceeds 100 items
    if len(_waveform_cache) > 100:
        oldest_key = next(iter(_waveform_cache.keys()))
        del _waveform_cache[oldest_key]

    try:
        # Instead of computing num_peaks from probed duration, pass peaks_per_sec directly.
        peaks, actual_duration = _generate_peaks(str(file_path), peaks_per_sec)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Waveform generation failed: {e}")

    result = {
        "peaks": peaks,
        "duration": actual_duration,
        "peaks_per_sec": peaks_per_sec,
    }
    _waveform_cache[cache_key] = result
    return result


def _generate_peaks(path: str, peaks_per_sec: int) -> tuple[list[float], float]:
    """Extract audio peaks using ffmpeg. Returns (peaks, duration_sec)."""
    sample_rate = 8000
    result = subprocess.run(
        [
            "ffmpeg", "-v", "quiet",
            "-i", path,
            "-ac", "1",           # mono
            "-ar", str(sample_rate),
            "-f", "f32le",        # raw 32-bit float little-endian
            "-",                  # pipe to stdout
        ],
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg exited with code {result.returncode}")

    raw = result.stdout
    if len(raw) < 4:
        # Ensure we return at least one point so frontend doesn't crash
        return [0.0], 0.0

    # Parse raw f32le samples
    num_samples = len(raw) // 4
    duration = num_samples / sample_rate
    samples = struct.unpack(f"<{num_samples}f", raw[:num_samples * 4])

    # Chunk samples strictly based on sample_rate and peaks_per_sec
    chunk_size = max(1, sample_rate // peaks_per_sec)
    peaks: list[float] = []
    
    # samples is a tuple of floats
    for i in range(0, num_samples, chunk_size):
        end_idx = min(i + chunk_size, num_samples)
        chunk = samples[i:end_idx]
        peak = max((abs(s) for s in chunk), default=0.0)
        peaks.append(min(peak, 1.0))

    return peaks, duration
