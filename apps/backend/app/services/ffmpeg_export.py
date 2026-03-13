"""FFmpeg-based video export with overlay compositing and ASS subtitles."""

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path

from app.config import settings
from app.models.timeline import TimelineProject, VideoStyle, Clip, MediaAsset
from app.services.ass_export import generate_ass
from app.services.srt_export import write_srt_file
from app.services.export_jobs import update_job
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)


# ── FFmpeg / ffprobe binary discovery ────────────────────────


def _find_ffmpeg() -> str:
    if settings.ffmpeg_path:
        return settings.ffmpeg_path
    path = shutil.which("ffmpeg")
    if path:
        return path
    raise RuntimeError("FFmpeg not found. Install ffmpeg or set MRDV2_FFMPEG_PATH.")


def _find_ffprobe() -> str:
    if settings.ffmpeg_path:
        probe = Path(settings.ffmpeg_path).parent / "ffprobe"
        if probe.exists():
            return str(probe)
    path = shutil.which("ffprobe")
    if path:
        return path
    raise RuntimeError("ffprobe not found. Install ffmpeg or set MRDV2_FFMPEG_PATH.")


# ── Media helpers ────────────────────────────────────────────


async def _has_audio_stream(ffprobe: str, file_path: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            ffprobe,
            "-v", "quiet",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await proc.communicate()
        return b"audio" in stdout
    except Exception:
        return False


def _resolve_media_path(clip: Clip, timeline: TimelineProject) -> str | None:
    if not clip.media_id:
        return None
    for asset in timeline.media_pool:
        if asset.id == clip.media_id:
            p = Path(asset.path)
            if not p.is_absolute():
                p = p.resolve()
            return str(p) if p.exists() else None
    return None


def _get_asset(clip: Clip, timeline: TimelineProject) -> MediaAsset | None:
    if not clip.media_id:
        return None
    for asset in timeline.media_pool:
        if asset.id == clip.media_id:
            return asset
    return None


# ── Filter building helpers ──────────────────────────────────


def _crop_filter(vs: VideoStyle, asset: MediaAsset | None) -> str:
    cl, ct, cr, cb = vs.crop_left, vs.crop_top, vs.crop_right, vs.crop_bottom
    if cl <= 0 and ct <= 0 and cr <= 0 and cb <= 0:
        return ""
    if asset and asset.width and asset.height:
        sw, sh = asset.width, asset.height
        cw = max(2, int(sw * max(1 - cl - cr, 0.1)))
        ch = max(2, int(sh * max(1 - ct - cb, 0.1)))
        cx, cy = int(sw * cl), int(sh * ct)
        return f",crop={cw}:{ch}:{cx}:{cy}"
    # Expression fallback when source dimensions are unknown
    vw = f"iw*{max(1 - cl - cr, 0.1):.6f}"
    vh = f"ih*{max(1 - ct - cb, 0.1):.6f}"
    vx = f"iw*{cl:.6f}"
    vy = f"ih*{ct:.6f}"
    return f",crop={vw}:{vh}:{vx}:{vy}"


def _scale_filter(vs: VideoStyle, frame_w: int, frame_h: int) -> str:
    # Ensure even dimensions (required by libx264)
    bw = max(2, int(frame_w * vs.width) // 2 * 2)
    bh = max(2, int(frame_h * vs.height) // 2 * 2)
    if vs.fit == "cover":
        return (
            f",scale={bw}:{bh}:force_original_aspect_ratio=increase"
            f",crop={bw}:{bh},setsar=1"
        )
    elif vs.fit == "fill":
        return f",scale={bw}:{bh},setsar=1"
    # contain (default): letterbox with black bars
    return (
        f",scale={bw}:{bh}:force_original_aspect_ratio=decrease"
        f",pad={bw}:{bh}:-1:-1:color=black,setsar=1"
    )


def _atempo_chain(speed: float) -> str:
    """Build chained atempo filters.  atempo supports [0.5, 100]."""
    filters: list[str] = []
    s = speed
    while s > 2.0:
        filters.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        filters.append("atempo=0.5")
        s *= 2.0
    filters.append(f"atempo={s:.6f}")
    return "," + ",".join(filters)


def _escape_filter_path(path: str) -> str:
    """Escape a file path for use inside an FFmpeg filter option value."""
    return path.replace("\\", "/").replace(":", "\\:").replace("'", "'\\''")


# ── Core filter_complex builder ──────────────────────────────


def _build_filter_complex(
    timeline: TimelineProject,
    subtitle_path: str | None,
    subtitle_format: str,
    audio_probe_results: dict[str, bool],
) -> tuple[list[str], str, bool]:
    """Build FFmpeg filter_complex script and input arguments.

    Returns ``(input_args, filter_script, has_audio)``.
    """
    W = timeline.project.width
    H = timeline.project.height
    fps = timeline.project.fps

    total_dur = 0.0
    for track in timeline.tracks:
        for clip in track.clips:
            total_dur = max(total_dur, clip.timeline_end_sec)
    if total_dur <= 0:
        raise ValueError("Timeline has no duration")

    input_args: list[str] = []
    filter_lines: list[str] = []
    input_idx = 0
    current_label = "base"

    # Persistent black background
    filter_lines.append(
        f"color=c=black:s={W}x{H}:r={fps}:d={total_dur:.6f}[base]"
    )

    # Track video clip inputs so audio can reuse the same index
    video_clip_inputs: list[tuple[Clip, int, str]] = []

    # ── Video overlay chain (array order = bottom → top) ─────
    video_tracks = [t for t in timeline.tracks if t.type == "video" and not t.muted]

    for track in video_tracks:
        for clip in track.clips:
            media_path = _resolve_media_path(clip, timeline)
            if not media_path:
                continue
            asset = _get_asset(clip, timeline)
            asset_type = asset.type if asset else "video"
            vs = clip.video_style or VideoStyle()

            # Input flags
            if asset_type == "image":
                input_args += ["-loop", "1", "-i", media_path]
            else:
                input_args += ["-i", media_path]

            video_clip_inputs.append((clip, input_idx, media_path))

            # Per-clip filter chain
            chain = f"[{input_idx}:v]"
            ts = clip.timeline_start_sec
            if asset_type == "image":
                clip_dur = clip.timeline_end_sec - clip.timeline_start_sec
                chain += (
                    f"fps={fps},trim=duration={clip_dur:.6f}"
                    f",setpts=PTS-STARTPTS+{ts:.6f}/TB"
                )
            else:
                source_in = clip.source_in_sec or 0.0
                speed = clip.speed if clip.speed else 1.0
                if clip.source_out_sec is not None:
                    source_out = clip.source_out_sec
                else:
                    clip_dur = clip.timeline_end_sec - clip.timeline_start_sec
                    source_out = source_in + clip_dur * speed
                if speed != 1.0:
                    chain += (
                        f"trim=start={source_in:.6f}:end={source_out:.6f}"
                        f",setpts=(PTS-STARTPTS)/{speed:.6f}+{ts:.6f}/TB"
                    )
                else:
                    chain += (
                        f"trim=start={source_in:.6f}:end={source_out:.6f}"
                        f",setpts=PTS-STARTPTS+{ts:.6f}/TB"
                    )

            chain += _crop_filter(vs, asset)
            chain += _scale_filter(vs, W, H)

            if vs.opacity < 1.0:
                chain += f",format=rgba,colorchannelmixer=aa={vs.opacity:.4f}"

            clip_label = f"c{input_idx}"
            chain += f"[{clip_label}]"
            filter_lines.append(chain)

            # Overlay onto current composite
            x = int((vs.position_x - vs.width / 2) * W)
            y = int((vs.position_y - vs.height / 2) * H)
            next_label = f"v{input_idx}"

            overlay_fmt = ":format=auto" if vs.opacity < 1.0 else ""
            filter_lines.append(
                f"[{current_label}][{clip_label}]"
                f"overlay=x={x}:y={y}"
                f":eof_action=pass"
                f"{overlay_fmt}[{next_label}]"
            )
            current_label = next_label
            input_idx += 1

    # ── FPS normalization ────────────────────────────────────
    filter_lines.append(f"[{current_label}]fps={fps}[vfps]")

    # ── Subtitle burn-in ─────────────────────────────────────
    if subtitle_path and subtitle_format == "ass":
        safe = _escape_filter_path(subtitle_path)
        filter_lines.append(f"[vfps]ass={safe}[vout]")
    elif subtitle_path and subtitle_format == "srt":
        safe = _escape_filter_path(subtitle_path)
        filter_lines.append(f"[vfps]subtitles={safe}[vout]")
    else:
        filter_lines.append("[vfps]null[vout]")

    # ── Audio mixing ─────────────────────────────────────────
    audio_sources: list[tuple[Clip, int, int]] = []  # (clip, idx, delay_ms)

    # Reuse video inputs that have audio
    for clip, idx, media_path in video_clip_inputs:
        track_for_clip = next(
            (t for t in timeline.tracks if any(c.id == clip.id for c in t.clips)),
            None,
        )
        if track_for_clip and track_for_clip.muted:
            continue
        if audio_probe_results.get(media_path, False):
            audio_sources.append((clip, idx, int(clip.timeline_start_sec * 1000)))

    # Dedicated audio track clips (need new inputs)
    for track in timeline.tracks:
        if track.muted or track.type != "audio":
            continue
        for clip in track.clips:
            media_path = _resolve_media_path(clip, timeline)
            if not media_path:
                continue
            input_args += ["-i", media_path]
            audio_sources.append((clip, input_idx, int(clip.timeline_start_sec * 1000)))
            input_idx += 1

    has_audio = bool(audio_sources)

    if has_audio:
        for clip, idx, delay in audio_sources:
            source_in = clip.source_in_sec or 0.0
            speed = clip.speed if clip.speed else 1.0
            if clip.source_out_sec is not None:
                source_out = clip.source_out_sec
            else:
                clip_dur = clip.timeline_end_sec - clip.timeline_start_sec
                source_out = source_in + clip_dur * speed
            chain = (
                f"[{idx}:a]"
                f"atrim=start={source_in:.6f}:end={source_out:.6f},"
                f"asetpts=PTS-STARTPTS"
            )
            if clip.speed and clip.speed != 1.0:
                chain += _atempo_chain(clip.speed)
            chain += f",adelay={delay}|{delay}[a{idx}]"
            filter_lines.append(chain)

        if len(audio_sources) == 1:
            _, idx, _ = audio_sources[0]
            filter_lines.append(f"[a{idx}]anull[aout]")
        else:
            labels = "".join(f"[a{idx}]" for _, idx, _ in audio_sources)
            n = len(audio_sources)
            filter_lines.append(
                f"{labels}amix=inputs={n}:normalize=0:duration=longest[aout]"
            )

    filter_script = ";\n".join(filter_lines)
    return input_args, filter_script, has_audio


# ── Public entry point ───────────────────────────────────────


async def run_ffmpeg_export(
    export_id: str,
    project_id: str,
    timeline: TimelineProject,
    output_path: str,
    subtitle_burn_in: str = "ass",
) -> None:
    """Run the three-stage FFmpeg export pipeline."""
    output_path = str(Path(output_path).resolve())
    update_job(export_id, status="rendering", progress=0.0)
    await ws_manager.broadcast_export_progress(project_id, export_id, 0.0, "rendering")

    tmp_dir = None
    try:
        ffmpeg = _find_ffmpeg()
        ffprobe = _find_ffprobe()
        tmp_dir = tempfile.mkdtemp(prefix="mrdv2_ffmpeg_")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # ── Probe audio streams for video clips ──────────────
        audio_probe: dict[str, bool] = {}
        video_tracks = [t for t in timeline.tracks if t.type == "video" and not t.muted]
        for track in video_tracks:
            for clip in track.clips:
                mp = _resolve_media_path(clip, timeline)
                if mp and mp not in audio_probe:
                    audio_probe[mp] = await _has_audio_stream(ffprobe, mp)

        # ── Generate subtitle file for burn-in ───────────────
        if subtitle_burn_in == "ass":
            subtitle_path = generate_ass(timeline, f"{tmp_dir}/subtitles.ass")
            subtitle_format = "ass"
        elif subtitle_burn_in == "srt":
            subtitle_path = write_srt_file(timeline, f"{tmp_dir}/subtitles.srt")
            subtitle_format = "srt"
        else:
            subtitle_path = None
            subtitle_format = "none"

        # ── Validate input count ─────────────────────────────
        # Subtitle tracks use ASS burn-in and don't consume FFmpeg inputs
        total_clips = sum(
            len(t.clips) for t in timeline.tracks
            if not t.muted and t.type != "subtitle"
        )
        if total_clips > settings.ffmpeg_max_inputs:
            raise ValueError(
                f"Too many clips ({total_clips}). "
                f"Maximum supported: {settings.ffmpeg_max_inputs}."
            )

        # ── Build filter_complex ─────────────────────────────
        input_args, filter_script, has_audio = _build_filter_complex(
            timeline, subtitle_path, subtitle_format, audio_probe
        )

        filter_path = f"{tmp_dir}/filter.txt"
        Path(filter_path).write_text(filter_script, encoding="utf-8")
        logger.info("Filter script written to %s", filter_path)
        logger.debug("Filter script:\n%s", filter_script)

        # ── Assemble FFmpeg command ──────────────────────────
        cmd = [ffmpeg, "-y"]
        cmd += input_args
        cmd += ["-filter_complex_script", filter_path]
        cmd += ["-map", "[vout]"]
        if has_audio:
            cmd += ["-map", "[aout]"]
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18"]
        if has_audio:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        cmd += ["-movflags", "+faststart", output_path]

        logger.info("FFmpeg command: %s", " ".join(cmd))

        # ── Compute total duration for progress ──────────────
        total_dur = 0.0
        for track in timeline.tracks:
            for clip in track.clips:
                total_dur = max(total_dur, clip.timeline_end_sec)

        # ── Run FFmpeg with real-time stderr progress ─────────
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stderr_lines: list[bytes] = []
        last_broadcast = 0.0

        async def _read_stderr():
            nonlocal last_broadcast
            import re
            time_re = re.compile(rb"time=(\d+):(\d+):(\d+)\.(\d+)")
            assert proc.stderr is not None
            async for line in proc.stderr:
                stderr_lines.append(line)
                m = time_re.search(line)
                if m and total_dur > 0:
                    h, mi, s, cs = (int(x) for x in m.groups())
                    elapsed = h * 3600 + mi * 60 + s + int(cs) / 100
                    progress = min(elapsed / total_dur, 0.99)
                    if progress - last_broadcast >= 0.02:  # broadcast every ~2%
                        last_broadcast = progress
                        update_job(export_id, progress=progress)
                        await ws_manager.broadcast_export_progress(
                            project_id, export_id, progress, "rendering"
                        )

        await asyncio.gather(proc.wait(), _read_stderr())
        stderr = b"".join(stderr_lines)

        if proc.returncode != 0:
            detail = stderr.decode(errors="replace")[-800:]
            msg = f"FFmpeg failed (exit {proc.returncode}): {detail}"
            logger.error(msg)
            update_job(export_id, status="error", error=msg)
            await ws_manager.broadcast_export_progress(
                project_id, export_id, 0.0, "error"
            )
            return

        if not Path(output_path).exists():
            msg = "FFmpeg completed but output file not found"
            logger.error(msg)
            update_job(export_id, status="error", error=msg)
            await ws_manager.broadcast_export_progress(
                project_id, export_id, 0.0, "error"
            )
            return

        size_mb = Path(output_path).stat().st_size / 1024 / 1024
        update_job(export_id, status="completed", progress=1.0)
        await ws_manager.broadcast_export_progress(
            project_id, export_id, 1.0, "completed"
        )
        logger.info("FFmpeg export completed: %s (%.1f MB)", output_path, size_mb)

    except Exception as e:
        msg = f"FFmpeg export error: {e}"
        logger.exception(msg)
        update_job(export_id, status="error", error=msg)
        await ws_manager.broadcast_export_progress(
            project_id, export_id, 0.0, "error"
        )
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
