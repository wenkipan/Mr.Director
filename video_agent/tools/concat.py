import subprocess
from pathlib import Path


def concat_videos(
    video_paths: list[str],
    output_name: str,
    workspace_dir: str,
) -> str:
    """Concatenate multiple video clips into one video.

    Args:
        video_paths: List of absolute paths to video files to concatenate, in order
            (e.g. ["/home/user/workspace/clip1.mp4", "/home/user/workspace/clip2.mp4"]).
        output_name: Name for the output file (e.g. "merged.mp4").
        workspace_dir: Absolute path to the workspace directory.

    Returns:
        Path to the concatenated video.
    """
    ws = Path(workspace_dir)
    concat_list = ws / "_concat_list.txt"

    with open(concat_list, "w") as f:
        for vp in video_paths:
            f.write(f"file '{vp}'\n")

    out = ws / output_name
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
