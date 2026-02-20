import subprocess
from pathlib import Path

from video_agent.config import COMPRESS_BITRATE, COMPRESS_MAX_SIZE_MB, COMPRESS_SHORT_SIDE

AUDIO_BITRATE_KBPS = 128


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


def _parse_bitrate_bps(bitrate_str: str) -> int:
    """Parse ffmpeg bitrate string (e.g. '1M', '500k') to bits per second."""
    s = bitrate_str.strip()
    if s.endswith("M") or s.endswith("m"):
        return int(float(s[:-1]) * 1_000_000)
    if s.endswith("K") or s.endswith("k"):
        return int(float(s[:-1]) * 1_000)
    return int(s)


def _calc_video_bitrate(duration: float, max_size_mb: float) -> str:
    """Calculate video bitrate (as ffmpeg string like '418k') to fit within max_size_mb."""
    target_bits = max_size_mb * 8 * 1024 * 1024
    audio_bits = AUDIO_BITRATE_KBPS * 1000 * duration
    video_bits = target_bits - audio_bits
    video_bitrate_kbps = int(max(100, video_bits / duration / 1000))
    return f"{video_bitrate_kbps}k"


def compress_video(input_path: str, workspace_dir: str) -> str:
    """Compress video for faster iteration editing.

    Uses COMPRESS_BITRATE (fixed) by default. Only switches to an adaptive
    bitrate when the estimated output size would exceed COMPRESS_MAX_SIZE_MB,
    preserving quality for short videos while capping file size for long ones.

    Args:
        input_path: Absolute path to the source video file (e.g. /home/user/videos/clip.mp4).
            Must be an absolute path. Use list_files to get the absolute path first.
        workspace_dir: Absolute path to the workspace directory. Also used as the base
            directory when input_path is a relative path.

    Returns:
        Absolute path to the compressed video file inside workspace_dir.
    """
    inp = Path(input_path)
    out = Path(workspace_dir) / f"{inp.stem}_compressed.mp4"
    if out.exists():
        return str(out)

    duration = _get_duration(str(inp))
    if duration and duration > 0:
        video_bps = _parse_bitrate_bps(COMPRESS_BITRATE)
        estimated_mb = (video_bps + AUDIO_BITRATE_KBPS * 1000) * duration / 8 / 1024 / 1024
        if estimated_mb > COMPRESS_MAX_SIZE_MB:
            bitrate = _calc_video_bitrate(duration, COMPRESS_MAX_SIZE_MB)
        else:
            bitrate = COMPRESS_BITRATE
    else:
        bitrate = COMPRESS_BITRATE

    short = COMPRESS_SHORT_SIDE
    cmd = [
        "ffmpeg", "-y", "-i", str(inp),
        "-vf", f"scale='if(gt(iw,ih),-2,{short})':'if(gt(iw,ih),{short},-2)'",
        "-b:v", bitrate,
        "-c:a", "aac", "-b:a", f"{AUDIO_BITRATE_KBPS}k",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
