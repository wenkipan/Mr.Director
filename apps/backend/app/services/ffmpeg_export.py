import asyncio
import logging
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.models.timeline import TimelineProject, Clip, Track
from app.services.export_jobs import update_job
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)


@dataclass
class SrtEntry:
    start_sec: float
    end_sec: float
    text: str


def parse_srt(content: str) -> list[SrtEntry]:
    """Parse SRT file content into structured entries."""
    entries: list[SrtEntry] = []
    blocks = content.strip().replace("\r\n", "\n").split("\n\n")
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        # Skip index line, parse timestamp line
        time_match = re.match(
            r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})",
            lines[1],
        )
        if not time_match:
            continue
        start = _parse_srt_ts(time_match.group(1))
        end = _parse_srt_ts(time_match.group(2))
        text = "\n".join(lines[2:])
        entries.append(SrtEntry(start_sec=start, end_sec=end, text=text))
    return entries


def _parse_srt_ts(ts: str) -> float:
    """Parse SRT timestamp 'HH:MM:SS,mmm' to seconds."""
    hms, ms = ts.split(",")
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def resolve_media_path(media_id: str, timeline: TimelineProject) -> str:
    for asset in timeline.media_pool:
        if asset.id == media_id:
            return asset.path
    raise ValueError(f"Media asset not found: {media_id}")


def _calculate_total_duration(timeline: TimelineProject) -> float:
    max_end = 0.0
    for track in timeline.tracks:
        if track.muted:
            continue
        for clip in track.clips:
            clip_end = clip.timeline_start_sec + clip.duration_sec
            if clip_end > max_end:
                max_end = clip_end
    return max_end


def _sec_to_srt_ts(sec: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm."""
    total_ms = round(sec * 1000)
    h = total_ms // 3_600_000
    total_ms %= 3_600_000
    m = total_ms // 60_000
    total_ms %= 60_000
    s = total_ms // 1000
    ms = total_ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _build_force_style(style) -> str:
    """Build an ASS force_style string from a SubtitleStyle object."""
    if not style:
        return ""
    parts: list[str] = []
    if style.font_family and style.font_family != "sans-serif":
        parts.append(f"FontName={style.font_family}")
    if style.font_size:
        parts.append(f"FontSize={style.font_size}")
    if style.color:
        # Convert CSS hex color (#RRGGBB) to ASS color (&HBBGGRR&)
        c = style.color.lstrip("#")
        if len(c) == 6:
            r, g, b = c[0:2], c[2:4], c[4:6]
            parts.append(f"PrimaryColour=&H00{b}{g}{r}&")
    if style.position_y is not None:
        # ASS MarginV: distance from bottom in pixels (approximate)
        margin_v = int((1.0 - style.position_y) * 100)
        parts.append(f"MarginV={max(margin_v, 10)}")
    return ",".join(parts)


def build_ffmpeg_command(timeline: TimelineProject, output_path: str) -> tuple[list[str], list[str]]:
    """Translate Timeline JSON into an ffmpeg command."""
    width = timeline.project.width
    height = timeline.project.height
    fps = timeline.project.fps
    total_duration = _calculate_total_duration(timeline)

    if total_duration <= 0:
        raise ValueError("Timeline has no content to export")

    # Collect all clips by type, sorted by timeline_start_sec
    video_clips: list[tuple[Track, Clip]] = []
    audio_clips: list[tuple[Track, Clip]] = []
    subtitle_clips: list[tuple[Track, Clip]] = []

    for track in timeline.tracks:
        if track.muted:
            continue
        for clip in sorted(track.clips, key=lambda c: c.timeline_start_sec):
            if track.type == "video":
                video_clips.append((track, clip))
            elif track.type == "audio":
                audio_clips.append((track, clip))
            elif track.type == "subtitle":
                subtitle_clips.append((track, clip))

    # Build command
    inputs: list[str] = []
    filter_parts: list[str] = []
    input_idx = 0

    # --- Video clips ---
    v_segments: list[str] = []

    if not video_clips:
        # No video clips — generate a black background
        inputs.extend([
            "-f", "lavfi",
            "-i", f"color=c=black:s={width}x{height}:r={fps}:d={total_duration}",
        ])
        v_segments.append(f"[{input_idx}:v]")
        input_idx += 1
    else:
        # Sort all video clips by timeline start for proper ordering
        sorted_v = sorted(video_clips, key=lambda tc: tc[1].timeline_start_sec)
        current_time = 0.0

        for track, clip in sorted_v:
            if not clip.media_id:
                continue
            media_path = resolve_media_path(clip.media_id, timeline)

            # Fill gap before this clip with black
            gap = clip.timeline_start_sec - current_time
            if gap > 0.01:
                inputs.extend([
                    "-f", "lavfi",
                    "-i", f"color=c=black:s={width}x{height}:r={fps}:d={gap}",
                ])
                label = f"vgap{input_idx}"
                filter_parts.append(f"[{input_idx}:v]setpts=PTS-STARTPTS[{label}]")
                v_segments.append(f"[{label}]")
                input_idx += 1

            # Add the video clip input
            inputs.extend(["-i", media_path])
            src_duration = (clip.source_out_sec - clip.source_in_sec) if clip.source_out_sec else clip.duration_sec * clip.speed
            speed = clip.speed if clip.speed and clip.speed != 0 else 1.0

            label = f"v{input_idx}"
            filters = []
            filters.append(f"trim=start={clip.source_in_sec}:duration={src_duration}")
            filters.append("setpts=PTS-STARTPTS")
            if speed != 1.0:
                filters.append(f"setpts={1.0/speed}*PTS")
            filters.append(f"scale={width}:{height}:force_original_aspect_ratio=decrease")
            filters.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2")
            filters.append("setpts=PTS-STARTPTS")

            filter_parts.append(f"[{input_idx}:v]{','.join(filters)}[{label}]")
            v_segments.append(f"[{label}]")
            input_idx += 1

            current_time = clip.timeline_start_sec + clip.duration_sec

        # Fill trailing gap
        trailing = total_duration - current_time
        if trailing > 0.01:
            inputs.extend([
                "-f", "lavfi",
                "-i", f"color=c=black:s={width}x{height}:r={fps}:d={trailing}",
            ])
            label = f"vgap{input_idx}"
            filter_parts.append(f"[{input_idx}:v]setpts=PTS-STARTPTS[{label}]")
            v_segments.append(f"[{label}]")
            input_idx += 1

        # Concat all video segments
        if len(v_segments) == 1:
            # Single segment — rename to vout
            seg = v_segments[0]  # e.g. [v2]
            inner = seg.strip("[]")
            filter_parts.append(f"[{inner}]null[vout]")
        else:
            concat_in = "".join(v_segments)
            filter_parts.append(f"{concat_in}concat=n={len(v_segments)}:v=1:a=0[vout]")

    # --- Audio clips ---
    a_segments: list[str] = []

    if audio_clips:
        sorted_a = sorted(audio_clips, key=lambda tc: tc[1].timeline_start_sec)
        current_time = 0.0

        for track, clip in sorted_a:
            if not clip.media_id:
                continue
            media_path = resolve_media_path(clip.media_id, timeline)

            # Fill gap with silence
            gap = clip.timeline_start_sec - current_time
            if gap > 0.01:
                inputs.extend([
                    "-f", "lavfi",
                    "-i", f"anullsrc=r=48000:cl=stereo:d={gap}",
                ])
                label = f"agap{input_idx}"
                filter_parts.append(f"[{input_idx}:a]asetpts=PTS-STARTPTS[{label}]")
                a_segments.append(f"[{label}]")
                input_idx += 1

            inputs.extend(["-i", media_path])
            src_duration = (clip.source_out_sec - clip.source_in_sec) if clip.source_out_sec else clip.duration_sec * clip.speed
            speed = clip.speed if clip.speed and clip.speed != 0 else 1.0

            label = f"a{input_idx}"
            filters = []
            filters.append(f"atrim=start={clip.source_in_sec}:duration={src_duration}")
            filters.append("asetpts=PTS-STARTPTS")
            if speed != 1.0:
                # atempo only supports 0.5..100.0 per filter, chain for extremes
                s = speed
                tempo_filters = []
                while s > 2.0:
                    tempo_filters.append("atempo=2.0")
                    s /= 2.0
                while s < 0.5:
                    tempo_filters.append("atempo=0.5")
                    s *= 2.0
                tempo_filters.append(f"atempo={s}")
                filters.extend(tempo_filters)

            filter_parts.append(f"[{input_idx}:a]{','.join(filters)}[{label}]")
            a_segments.append(f"[{label}]")
            input_idx += 1

            current_time = clip.timeline_start_sec + clip.duration_sec

        # Trailing silence
        trailing = total_duration - current_time
        if trailing > 0.01:
            inputs.extend([
                "-f", "lavfi",
                "-i", f"anullsrc=r=48000:cl=stereo:d={trailing}",
            ])
            label = f"agap{input_idx}"
            filter_parts.append(f"[{input_idx}:a]asetpts=PTS-STARTPTS[{label}]")
            a_segments.append(f"[{label}]")
            input_idx += 1

        if len(a_segments) == 1:
            seg = a_segments[0]
            inner = seg.strip("[]")
            filter_parts.append(f"[{inner}]anull[aout]")
        else:
            concat_in = "".join(a_segments)
            filter_parts.append(f"{concat_in}concat=n={len(a_segments)}:v=0:a=1[aout]")

    # --- Subtitle burn-in ---
    # Merge ALL subtitle sources (inline text + SRT files) into a single SRT,
    # then apply one `subtitles` filter. This prevents overlap caused by
    # chaining multiple independent subtitles filters.
    temp_srt_files: list[str] = []
    if subtitle_clips:
        merged_entries: list[SrtEntry] = []
        first_style = None

        for track, clip in subtitle_clips:
            # Inline text clip → single SRT entry
            if clip.subtitle_text:
                merged_entries.append(SrtEntry(
                    start_sec=clip.timeline_start_sec,
                    end_sec=clip.timeline_start_sec + clip.duration_sec,
                    text=clip.subtitle_text,
                ))
                if first_style is None and clip.subtitle_style:
                    first_style = clip.subtitle_style

            # SRT-file-backed clip → parse, trim, and offset entries
            elif clip.media_id:
                try:
                    srt_path = resolve_media_path(clip.media_id, timeline)
                    srt_content = Path(srt_path).read_text(encoding="utf-8")
                    entries = parse_srt(srt_content)
                except (ValueError, OSError) as e:
                    logger.warning("Skipping SRT clip %s: %s", clip.id, e)
                    continue

                src_in = clip.source_in_sec or 0.0
                src_out = clip.source_out_sec or (src_in + clip.duration_sec * (clip.speed or 1.0))
                time_offset = clip.timeline_start_sec - src_in

                for entry in entries:
                    # Skip entries outside the clip's source range
                    if entry.end_sec <= src_in or entry.start_sec >= src_out:
                        continue
                    # Clamp to source range, then offset to timeline position
                    clamped_start = max(entry.start_sec, src_in)
                    clamped_end = min(entry.end_sec, src_out)
                    merged_entries.append(SrtEntry(
                        start_sec=clamped_start + time_offset,
                        end_sec=clamped_end + time_offset,
                        text=entry.text,
                    ))

                if first_style is None and clip.subtitle_style:
                    first_style = clip.subtitle_style

        if merged_entries:
            # Sort by start time and write a single merged SRT
            merged_entries.sort(key=lambda e: e.start_sec)
            srt_lines: list[str] = []
            for idx, entry in enumerate(merged_entries, start=1):
                srt_lines.append(str(idx))
                srt_lines.append(
                    f"{_sec_to_srt_ts(entry.start_sec)} --> {_sec_to_srt_ts(entry.end_sec)}"
                )
                srt_lines.append(entry.text)
                srt_lines.append("")

            tmp = tempfile.NamedTemporaryFile(
                mode="w", suffix=".srt", delete=False, encoding="utf-8"
            )
            tmp.write("\n".join(srt_lines))
            tmp.flush()
            tmp.close()
            temp_srt_files.append(tmp.name)

            escaped_path = tmp.name.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
            force_style = _build_force_style(first_style)
            style_part = f":force_style='{force_style}'" if force_style else ""
            filter_parts.append(
                f"[vout]subtitles='{escaped_path}'{style_part}[vfinal]"
            )
            final_video_label = "vfinal"
        else:
            final_video_label = "vout"
    else:
        final_video_label = "vout"

    # Assemble full command
    filter_complex = ";\n".join(filter_parts)

    cmd = ["ffmpeg", "-y"]
    cmd.extend(inputs)
    cmd.extend(["-filter_complex", filter_complex])
    cmd.extend(["-map", f"[{final_video_label}]"])

    if a_segments:
        cmd.extend(["-map", "[aout]"])
        cmd.extend(["-c:a", "aac", "-b:a", "192k"])
    else:
        # Check if any video input might have audio we should use
        cmd.extend(["-an"])

    cmd.extend([
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-r", str(fps),
        "-s", f"{width}x{height}",
        "-movflags", "+faststart",
        output_path,
    ])

    return cmd, temp_srt_files


def _parse_ffmpeg_progress(line: str, total_duration: float) -> float | None:
    """Parse ffmpeg stderr output for progress."""
    match = re.search(r"time=(\d+):(\d+):(\d+)\.(\d+)", line)
    if match:
        h, m, s, cs = int(match.group(1)), int(match.group(2)), int(match.group(3)), int(match.group(4))
        current = h * 3600 + m * 60 + s + cs / 100.0
        if total_duration > 0:
            return min(current / total_duration, 1.0)
    return None


async def run_export(
    export_id: str,
    project_id: str,
    timeline: TimelineProject,
    output_path: str,
) -> None:
    """Run the FFmpeg export as an async subprocess."""
    total_duration = _calculate_total_duration(timeline)
    temp_files: list[str] = []

    try:
        cmd, temp_files = build_ffmpeg_command(timeline, output_path)
        logger.info("Export %s: running ffmpeg command", export_id)
        logger.debug("FFmpeg cmd: %s", " ".join(cmd))

        update_job(export_id, status="rendering", progress=0.0)
        await ws_manager.broadcast_export_progress(project_id, export_id, 0.0, "rendering")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            decoded = line.decode("utf-8", errors="replace")
            progress = _parse_ffmpeg_progress(decoded, total_duration)
            if progress is not None:
                update_job(export_id, progress=progress)
                await ws_manager.broadcast_export_progress(
                    project_id, export_id, progress, "rendering"
                )

        await proc.wait()

        if proc.returncode == 0:
            update_job(export_id, status="completed", progress=1.0)
            await ws_manager.broadcast_export_progress(
                project_id, export_id, 1.0, "completed"
            )
            logger.info("Export %s: completed successfully", export_id)
        else:
            stderr_remaining = ""
            if proc.stderr:
                data = await proc.stderr.read()
                stderr_remaining = data.decode("utf-8", errors="replace")[-500:]
            error_msg = f"FFmpeg exited with code {proc.returncode}: {stderr_remaining}"
            update_job(export_id, status="error", error=error_msg)
            await ws_manager.broadcast_export_progress(
                project_id, export_id, 0.0, "error"
            )
            logger.error("Export %s: %s", export_id, error_msg)

    except Exception as e:
        error_msg = str(e)
        update_job(export_id, status="error", error=error_msg)
        await ws_manager.broadcast_export_progress(
            project_id, export_id, 0.0, "error"
        )
        logger.exception("Export %s: unexpected error", export_id)

    finally:
        # Clean up temporary SRT files
        for f in temp_files:
            try:
                Path(f).unlink(missing_ok=True)
            except OSError:
                pass
