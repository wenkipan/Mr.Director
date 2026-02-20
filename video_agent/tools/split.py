import json
import subprocess
from pathlib import Path


def _get_duration(input_path: str) -> float | None:
    """Return video duration in seconds using ffprobe, or None on failure."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            input_path,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def split_video(input_path: str, workspace_dir: str, segment_duration: int = 600) -> str:
    """Split a long video into smaller time-based segments (stream copy, no re-encode).

    Use this BEFORE compress_video when the source video is very long (e.g. > 10 minutes).
    Splitting lets each segment be compressed independently at much higher quality,
    instead of crushing the entire video into 20 MB at an unacceptably low bitrate.

    If the video is already shorter than segment_duration, it is returned as-is in a
    single-element list without creating any new files.

    After calling split_video, for each segment:
      1. Call compress_video(segment["path"], workspace_dir)
      2. Call analyze_video(compressed_path, workspace_dir)
      3. Add segment["start_time"] to every timestamp in the analysis to get the
         real timestamp in the original video.

    Args:
        input_path: Absolute path to the source video file.
        workspace_dir: Absolute path to the workspace directory.
        segment_duration: Maximum duration of each segment in seconds (default: 600 = 10 min).

    Returns:
        JSON string — a list of objects, each with:
          - "path": absolute path to the segment file
          - "start_time": start offset of this segment in the original video (seconds)
          - "duration": actual duration of this segment (seconds)
        Example:
          [
            {"path": "/ws/rec_part000.mp4", "start_time":    0, "duration": 600.0},
            {"path": "/ws/rec_part001.mp4", "start_time":  600, "duration": 600.0},
            {"path": "/ws/rec_part002.mp4", "start_time": 1200, "duration": 183.5}
          ]
        Or an error message starting with "ERROR:".
    """
    inp = Path(input_path)
    ws = Path(workspace_dir)

    total_duration = _get_duration(str(inp))
    if total_duration is None:
        return "ERROR: Could not read video duration with ffprobe."

    # Video is already short enough — return it as a single-element list.
    if total_duration <= segment_duration:
        return json.dumps([
            {"path": str(inp), "start_time": 0, "duration": round(total_duration, 3)}
        ], ensure_ascii=False)

    pattern = str(ws / f"{inp.stem}_part%03d.mp4")

    cmd = [
        "ffmpeg", "-y", "-i", str(inp),
        "-c", "copy",
        "-f", "segment",
        "-segment_time", str(segment_duration),
        "-reset_timestamps", "1",
        pattern,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"

    parts = sorted(ws.glob(f"{inp.stem}_part*.mp4"))
    if not parts:
        return "ERROR: No segment files were created."

    segments = []
    for i, part in enumerate(parts):
        start = i * segment_duration
        dur = _get_duration(str(part)) or segment_duration
        segments.append({
            "path": str(part),
            "start_time": start,
            "duration": round(dur, 3),
        })

    return json.dumps(segments, ensure_ascii=False)
