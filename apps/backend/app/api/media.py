import os
import mimetypes
from pathlib import Path

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi",
    ".mp3", ".wav", ".aac", ".flac", ".ogg",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
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
                files.append({
                    "name": entry.name,
                    "path": str(entry),
                    "size": stat.st_size,
                    "mime_type": mime,
                    "type": _classify(entry.suffix.lower()),
                })
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
async def serve_media_file(path: str = Query(..., description="Absolute file path")):
    """Serve a local media file. Supports HTTP Range requests for video seeking."""
    file_path = Path(path).resolve()
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=403, detail="File type not allowed")

    mime, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(
        path=str(file_path),
        media_type=mime or "application/octet-stream",
        filename=file_path.name,
    )


def _classify(ext: str) -> str:
    if ext in {".mp4", ".mov", ".mkv", ".webm", ".avi"}:
        return "video"
    if ext in {".mp3", ".wav", ".aac", ".flac", ".ogg"}:
        return "audio"
    return "image"
