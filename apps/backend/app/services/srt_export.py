"""SRT subtitle export from TimelineProject."""

import logging
from dataclasses import dataclass
from pathlib import Path

from app.models.timeline import TimelineProject

logger = logging.getLogger(__name__)


@dataclass
class SrtEntry:
    start_sec: float
    end_sec: float
    text: str


def _sec_to_srt_ts(sec: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm."""
    total_ms = round(sec * 1000)
    h = total_ms // 3_600_000
    total_ms %= 3_600_000
    m = total_ms // 60_000
    total_ms %= 60_000
    s = total_ms // 1000
    ms = total_ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def extract_subtitles(timeline: TimelineProject) -> list[SrtEntry]:
    """Extract all subtitle entries from non-muted subtitle tracks."""
    entries: list[SrtEntry] = []
    for track in timeline.tracks:
        if track.muted or track.type != "subtitle":
            continue
        for clip in track.clips:
            if clip.subtitle_text:
                entries.append(SrtEntry(
                    start_sec=clip.timeline_start_sec,
                    end_sec=clip.timeline_end_sec,
                    text=clip.subtitle_text,
                ))
    entries.sort(key=lambda e: e.start_sec)
    return entries


def write_srt_file(timeline: TimelineProject, output_path: str) -> str | None:
    """Write SRT subtitle file to disk. Returns output_path if subtitles exist, else None."""
    content = generate_srt_string(timeline)
    if not content:
        return None
    Path(output_path).write_text(content, encoding="utf-8")
    return output_path


def generate_srt_string(timeline: TimelineProject) -> str | None:
    """Generate SRT file content from timeline subtitle tracks.

    Returns None if there are no subtitles.
    """
    entries = extract_subtitles(timeline)
    if not entries:
        return None

    lines: list[str] = []
    for idx, entry in enumerate(entries, start=1):
        lines.append(str(idx))
        lines.append(f"{_sec_to_srt_ts(entry.start_sec)} --> {_sec_to_srt_ts(entry.end_sec)}")
        lines.append(entry.text)
        lines.append("")
    return "\n".join(lines)
