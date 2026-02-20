import subprocess
from pathlib import Path


def crop_video(
    input_path: str,
    width: int,
    height: int,
    output_name: str,
    workspace_dir: str,
    x: int = -1,
    y: int = -1,
) -> str:
    """Crop video to a specific region or aspect ratio.

    When x/y are -1 (default), the crop is centered automatically.
    Common use: convert landscape 16:9 to portrait 9:16 for TikTok/Douyin.

    Args:
        input_path: Absolute path to the source video (e.g. /home/user/workspace/clip.mp4).
        width: Target crop width in pixels.
        height: Target crop height in pixels.
        output_name: Name for the output file (e.g. "cropped.mp4").
        workspace_dir: Absolute path to the workspace directory.
        x: Left offset in pixels. -1 means center horizontally.
        y: Top offset in pixels. -1 means center vertically.

    Returns:
        Path to the cropped video.
    """
    out = Path(workspace_dir) / output_name

    x_expr = "(iw-ow)/2" if x == -1 else str(x)
    y_expr = "(ih-oh)/2" if y == -1 else str(y)

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", f"crop={width}:{height}:{x_expr}:{y_expr}",
        "-c:a", "copy",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
