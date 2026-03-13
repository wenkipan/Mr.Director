"""Filesystem tools: list_files, read_file, write_file."""

from __future__ import annotations

import os
from pathlib import Path

from app.tools.registry import registry

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi",
    ".mp3", ".wav", ".aac", ".flac", ".ogg",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
    ".txt", ".json", ".srt", ".vtt", ".ass", ".md",
}


@registry.register(
    name="list_files",
    description=(
        "List files in a directory. Filter by extension. Returns names, sizes, and types. "
        "\n\nWhen to use: discovering available media before starting an edit, checking for existing _analysis.md files. "
        "When NOT to use: reading file contents (use read_file), getting media metadata like duration/resolution (use run_shell with ffprobe)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "directory": {
                "type": "STRING",
                "description": "Absolute path to the directory to list",
            },
            "extensions": {
                "type": "STRING",
                "description": "Comma-separated file extensions to filter, e.g. '.mp4,.mov,.mkv'. Leave empty for all media files.",
            },
        },
        "required": ["directory"],
    },
)
async def list_files(args: dict, state) -> dict:
    directory = args["directory"]
    ext_filter = args.get("extensions", "")

    dir_path = Path(directory).resolve()
    if not dir_path.is_dir():
        return {"error": f"Directory not found: {directory}"}

    if ext_filter:
        exts = {e.strip().lower() for e in ext_filter.split(",")}
    else:
        exts = ALLOWED_EXTENSIONS

    files = []
    for entry in sorted(dir_path.iterdir()):
        if entry.is_file() and entry.suffix.lower() in exts:
            stat = entry.stat()
            files.append({
                "name": entry.name,
                "path": str(entry),
                "size_bytes": stat.st_size,
                "extension": entry.suffix.lower(),
            })
        elif entry.is_dir():
            files.append({
                "name": entry.name,
                "path": str(entry),
                "type": "directory",
            })

    return {"directory": str(dir_path), "file_count": len(files), "files": files}


@registry.register(
    name="read_file",
    description=(
        "Read a text file's content (txt, json, srt, vtt, ass, md, etc.). Truncated at 50KB. "
        "\n\nWhen to use: reading _analysis.md for cached analysis results, inspecting SRT/ASS subtitle files, "
        "reading project JSON. "
        "When NOT to use: getting media file metadata (use run_shell with ffprobe)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "file_path": {
                "type": "STRING",
                "description": "Absolute path to the file to read",
            },
        },
        "required": ["file_path"],
    },
)
async def read_file(args: dict, state) -> dict:
    file_path = Path(args["file_path"]).resolve()
    if not file_path.is_file():
        return {"error": f"File not found: {args['file_path']}"}

    try:
        content = file_path.read_text(encoding="utf-8")
        if len(content) > 50000:
            content = content[:50000] + "\n... (truncated)"
        return {"path": str(file_path), "content": content}
    except Exception as e:
        return {"error": f"Failed to read file: {str(e)}"}


@registry.register(
    name="write_file",
    description=(
        "Write content to a text file. Creates parent directories if needed. "
        "\n\nWhen to use: saving analysis notes, creating custom subtitle files, writing project artifacts. "
        "When NOT to use: modifying the timeline (use timeline tools), exporting (use export_timeline)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "file_path": {
                "type": "STRING",
                "description": "Absolute path to the file to write",
            },
            "content": {
                "type": "STRING",
                "description": "Content to write to the file",
            },
        },
        "required": ["file_path", "content"],
    },
)
async def write_file(args: dict, state) -> dict:
    file_path = Path(args["file_path"]).resolve()
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(args["content"], encoding="utf-8")
        return {"path": str(file_path), "success": True}
    except Exception as e:
        return {"error": f"Failed to write file: {str(e)}"}
