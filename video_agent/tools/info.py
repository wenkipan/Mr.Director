import json
import subprocess


def get_video_info(input_path: str) -> str:
    """Get technical metadata for a video file using ffprobe.

    Call this before add_subtitles or add_text_overlay to know the video
    dimensions, especially when handling vertical (portrait) videos where
    subtitles may overflow without proper margins.

    Args:
        input_path: Absolute path to the video file (e.g. /home/user/workspace/clip.mp4).

    Returns:
        JSON string with keys:
            width (int): Frame width in pixels.
            height (int): Frame height in pixels.
            fps (float): Frames per second.
            duration (float): Duration in seconds.
            has_audio (bool): Whether the video has an audio stream.
            video_codec (str): Video codec name (e.g. "h264").
            audio_codec (str | None): Audio codec name, or None if no audio.
        Tip: if height > width the video is vertical/portrait (e.g. 1080x1920).
    """
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            input_path,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        return json.dumps({"error": result.stderr[-300:]})

    data = json.loads(result.stdout)
    streams = data.get("streams", [])

    info: dict = {
        "width": None,
        "height": None,
        "fps": None,
        "duration": None,
        "has_audio": False,
        "video_codec": None,
        "audio_codec": None,
    }

    for stream in streams:
        codec_type = stream.get("codec_type")
        if codec_type == "video" and info["width"] is None:
            info["width"] = stream.get("width")
            info["height"] = stream.get("height")
            info["video_codec"] = stream.get("codec_name")
            dur = stream.get("duration")
            if dur:
                info["duration"] = round(float(dur), 3)
            fps_str = stream.get("r_frame_rate") or stream.get("avg_frame_rate", "0/1")
            try:
                num, den = fps_str.split("/")
                den_f = float(den)
                info["fps"] = round(float(num) / den_f, 3) if den_f != 0 else None
            except (ValueError, ZeroDivisionError):
                pass
        elif codec_type == "audio":
            info["has_audio"] = True
            info["audio_codec"] = stream.get("codec_name")

    # Fallback: read duration from container format if stream didn't have it
    if info["duration"] is None:
        result2 = subprocess.run(
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
        if result2.returncode == 0 and result2.stdout.strip():
            try:
                info["duration"] = round(float(result2.stdout.strip()), 3)
            except ValueError:
                pass

    return json.dumps(info)
