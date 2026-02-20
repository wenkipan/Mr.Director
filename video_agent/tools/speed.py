import subprocess
from pathlib import Path


def speed_video(
    input_path: str,
    factor: float,
    output_name: str,
    workspace_dir: str,
) -> str:
    """Change video playback speed.

    Args:
        input_path: Absolute path to the source video (e.g. /home/user/workspace/clip.mp4).
        factor: Speed multiplier. 2.0 = 2x faster, 0.5 = half speed.
        output_name: Name for the output file (e.g. "fast.mp4").
        workspace_dir: Absolute path to the workspace directory.

    Returns:
        Path to the speed-adjusted video.
    """
    out = Path(workspace_dir) / output_name

    if factor <= 0:
        return "ERROR: factor must be positive"

    # setpts: smaller PTS = faster. atempo only accepts [0.5, 100.0]
    video_filter = f"setpts={1/factor}*PTS"

    # Chain multiple atempo filters for extreme values
    atempo_filters = []
    remaining = factor
    while remaining > 2.0:
        atempo_filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        atempo_filters.append("atempo=0.5")
        remaining *= 2.0
    atempo_filters.append(f"atempo={remaining:.4f}")
    audio_filter = ",".join(atempo_filters)

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", video_filter,
        "-af", audio_filter,
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
