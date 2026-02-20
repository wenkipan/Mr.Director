import subprocess
from pathlib import Path


def cut_video(
    input_path: str,
    start_time: str,
    end_time: str,
    output_name: str,
    workspace_dir: str,
) -> str:
    """Cut a segment from a video by time range.

    Args:
        input_path: Absolute path to the source video (e.g. /home/user/workspace/clip.mp4).
        start_time: Start time with millisecond precision. Supported formats:
            - MM:SS.mmm  (e.g. "01:23.456" = 1 min 23.456 sec)
            - HH:MM:SS.mmm  (e.g. "00:01:23.456")
            - MM:SS  (e.g. "01:23" — second-level only, avoid for speech)
            - Decimal seconds  (e.g. "83.456")
            Always use millisecond precision when cutting speech to avoid
            cutting off words mid-syllable.
        end_time: End time. Same format as start_time.
        output_name: Name for the output file (e.g. "clip1.mp4").
        workspace_dir: Absolute path to the workspace directory.

    Returns:
        Path to the cut video segment.
    """
    out = Path(workspace_dir) / output_name
    # Re-encode for frame-accurate cuts. Stream copy (-c copy) is faster but
    # only cuts at keyframe boundaries, which can misalign speech by seconds.
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-ss", start_time, "-to", end_time,
        "-c:v", "libx264", "-c:a", "aac",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
