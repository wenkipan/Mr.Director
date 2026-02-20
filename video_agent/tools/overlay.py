import subprocess
from pathlib import Path


DEFAULT_CJK_FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def add_text_overlay(
    video_path: str,
    text: str,
    output_name: str,
    workspace_dir: str,
    x: str = "(w-text_w)/2",
    y: str = "(h-text_h)/2",
    start_time: float = 0,
    end_time: float = -1,
    font_size: int = 48,
    font_color: str = "white",
    border_width: int = 2,
    font_file: str = DEFAULT_CJK_FONT,
) -> str:
    """Add text overlay on video (different from subtitles: free position, style).

    Args:
        video_path: Absolute path to the input video (e.g. /home/user/workspace/clip.mp4).
        text: Text content to display.
        output_name: Name for the output file.
        workspace_dir: Absolute path to the workspace directory.
        x: Horizontal position expression. Default centers text.
        y: Vertical position expression. Default centers text.
        start_time: Show text from this timestamp (float seconds, supports sub-second
            precision). E.g. 1.5 = one and a half seconds, 0.5 = half a second. Default 0.
        end_time: Hide text after this timestamp (float seconds, same precision as
            start_time). -1 means show until end of video.
        font_size: Font size in pixels. Default 48.
        font_color: Font color name or hex. Default "white".
        border_width: Text border/shadow width. Default 2.
        font_file: Absolute path to a .ttf/.ttc font file. Defaults to Noto Sans CJK
            (supports Chinese/Japanese/Korean). Override if a different font is needed.

    Returns:
        Path to the video with text overlay.
    """
    out = Path(workspace_dir) / output_name

    # Escape special characters for drawtext
    escaped_text = text.replace("'", "\u2019").replace(":", r"\:").replace("\\", "\\\\")

    enable = f"between(t,{start_time},{end_time})" if end_time >= 0 else ""

    parts = [
        f"text='{escaped_text}'",
        f"fontfile='{font_file}'",
        f"fontsize={font_size}",
        f"fontcolor={font_color}",
        f"x={x}",
        f"y={y}",
        f"borderw={border_width}",
    ]
    if enable:
        parts.append(f"enable='{enable}'")

    drawtext_filter = f"drawtext={':'.join(parts)}"

    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", drawtext_filter,
        "-c:a", "copy",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
