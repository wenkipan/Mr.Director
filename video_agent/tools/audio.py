import subprocess
from pathlib import Path


def extract_audio(
    input_path: str,
    output_name: str,
    workspace_dir: str,
) -> str:
    """Extract audio track from a video file.

    Args:
        input_path: Absolute path to the source video (e.g. /home/user/workspace/clip.mp4).
        output_name: Name for the output audio file (e.g. "audio.aac", "audio.mp3").
        workspace_dir: Absolute path to the workspace directory.

    Returns:
        Path to the extracted audio file.
    """
    out = Path(workspace_dir) / output_name
    suffix = Path(output_name).suffix.lower()

    if suffix == ".mp3":
        codec_args = ["-c:a", "libmp3lame", "-q:a", "2"]
    elif suffix == ".wav":
        codec_args = ["-c:a", "pcm_s16le"]
    else:
        # .aac, .m4a, etc. — copy if possible
        codec_args = ["-c:a", "copy"]

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vn",
        *codec_args,
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        # Fallback: re-encode to AAC if copy fails
        cmd_fallback = [
            "ffmpeg", "-y", "-i", str(input_path),
            "-vn", "-c:a", "aac", "-b:a", "128k",
            str(out),
        ]
        result = subprocess.run(cmd_fallback, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            return f"ERROR: {result.stderr[-500:]}"
    return str(out)
