"""Convert TimelineProject to OpenTimelineIO format."""

import logging
import urllib.parse
from pathlib import Path

import opentimelineio as otio
from opentimelineio import opentime as ot

from app.models.timeline import TimelineProject, Track, Clip, MediaAsset

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_media(media_id: str, media_pool: list[MediaAsset]) -> MediaAsset | None:
    for asset in media_pool:
        if asset.id == media_id:
            return asset
    return None


def _sec_to_rt(sec: float, rate: float) -> ot.RationalTime:
    """Convert seconds to OTIO RationalTime at the given frame rate."""
    return ot.RationalTime(value=round(sec * rate), rate=rate)


def _build_media_reference(
    asset: MediaAsset, rate: float,
) -> otio.schema.ExternalReference:
    available_range = None
    if asset.duration_sec is not None:
        available_range = ot.TimeRange(
            start_time=ot.RationalTime(0, rate),
            duration=_sec_to_rt(asset.duration_sec, rate),
        )
    # DaVinci Resolve works best with bare absolute paths (no file:// prefix).
    # When Resolve itself exports OTIO, it uses bare paths. Using file:// URIs
    # can cause inconsistent relinking behavior between video and audio tracks.
    # We also avoid Path.as_uri() which percent-encodes spaces (%20) —
    # Resolve does not decode them and will fail to find the file.
    target_url = ""
    name = ""
    if asset.path:
        p = Path(asset.path).absolute()
        target_url = str(p)
        name = p.name  # filename for Resolve media relinking

    ref = otio.schema.ExternalReference(
        target_url=target_url,
        available_range=available_range,
    )
    ref.name = name
    return ref


def _build_source_range(clip: Clip, rate: float) -> ot.TimeRange:
    """Build source_range for an OTIO clip.

    source_in_sec  -> start_time
    source duration = source_out_sec - source_in_sec  (if available)
                    = (timeline_end - timeline_start) * speed  (otherwise, undo speed)
    """
    start_time = _sec_to_rt(clip.source_in_sec, rate)
    if clip.source_out_sec is not None:
        source_dur = clip.source_out_sec - clip.source_in_sec
    else:
        source_dur = (clip.timeline_end_sec - clip.timeline_start_sec) * clip.speed
    duration = _sec_to_rt(source_dur, rate)
    return ot.TimeRange(start_time=start_time, duration=duration)


def _build_gap(duration_sec: float, rate: float) -> otio.schema.Gap:
    return otio.schema.Gap(
        source_range=ot.TimeRange(
            start_time=ot.RationalTime(0, rate),
            duration=_sec_to_rt(duration_sec, rate),
        )
    )


# ---------------------------------------------------------------------------
# Track conversion
# ---------------------------------------------------------------------------

def _convert_track(
    track: Track, media_pool: list[MediaAsset], rate: float,
) -> otio.schema.Track:
    kind_map = {
        "video": otio.schema.TrackKind.Video,
        "audio": otio.schema.TrackKind.Audio,
    }
    otio_track = otio.schema.Track(
        name=track.name or track.id,
        kind=kind_map.get(track.type, otio.schema.TrackKind.Video),
    )

    sorted_clips = sorted(track.clips, key=lambda c: c.timeline_start_sec)
    current_time = 0.0

    for clip in sorted_clips:
        # Insert gap if there's space before this clip
        gap_duration = clip.timeline_start_sec - current_time
        if gap_duration > 1e-4:
            otio_track.append(_build_gap(gap_duration, rate))
            current_time += gap_duration

        # Media reference
        media = _find_media(clip.media_id, media_pool) if clip.media_id else None
        if media:
            media_ref = _build_media_reference(media, rate)
        else:
            media_ref = otio.schema.MissingReference()

        source_range = _build_source_range(clip, rate)

        otio_clip = otio.schema.Clip(
            name=clip.id,
            media_reference=media_ref,
            source_range=source_range,
        )

        # Video spatial properties (PiP, overlay, crop)
        if clip.video_style:
            otio_clip.metadata.setdefault("mrdv2", {})
            otio_clip.metadata["mrdv2"]["video_style"] = clip.video_style.model_dump()

        # Speed effect
        if abs(clip.speed - 1.0) > 1e-6:
            otio_clip.effects.append(
                otio.schema.LinearTimeWarp(
                    name=f"Speed {clip.speed}x",
                    time_scalar=clip.speed,
                )
            )

        otio_track.append(otio_clip)
        current_time = clip.timeline_end_sec

    return otio_track


def _convert_subtitle_track(
    track: Track, media_pool: list[MediaAsset], rate: float,
) -> otio.schema.Track:
    """Convert a subtitle track to an OTIO Video track with clips.

    OTIO has no native subtitle TrackKind, so we use TrackKind.Video
    with metadata marking it as a subtitle track. This ensures NLEs
    like Kdenlive actually import it as a visible track.

    Two kinds of subtitle clips are handled:
      - SRT-file-backed (media_id points to .srt) → ExternalReference
      - Inline text (subtitle_text is set) → GeneratorReference with text in metadata
    """
    otio_track = otio.schema.Track(
        name=track.name or track.id,
        kind=otio.schema.TrackKind.Video,
        metadata={"mrdv2": {"is_subtitle_track": True}},
    )

    sorted_clips = sorted(track.clips, key=lambda c: c.timeline_start_sec)
    current_time = 0.0

    for clip in sorted_clips:
        gap_duration = clip.timeline_start_sec - current_time
        if gap_duration > 1e-4:
            otio_track.append(_build_gap(gap_duration, rate))
            current_time += gap_duration

        source_range = _build_source_range(clip, rate)

        # Determine media reference
        if clip.subtitle_text:
            # Inline text subtitle → GeneratorReference
            media_ref = otio.schema.GeneratorReference(
                name="SubtitleGenerator",
                generator_kind="SubtitleText",
                metadata={
                    "mrdv2_subtitle_text": clip.subtitle_text,
                    "mrdv2_subtitle_style": clip.subtitle_style.model_dump() if clip.subtitle_style else {},
                },
            )
        elif clip.media_id:
            # SRT-file-backed subtitle → ExternalReference to .srt file
            media = _find_media(clip.media_id, media_pool)
            if media:
                media_ref = _build_media_reference(media, rate)
            else:
                media_ref = otio.schema.MissingReference()
        else:
            media_ref = otio.schema.MissingReference()

        otio_clip = otio.schema.Clip(
            name=clip.subtitle_text[:50] if clip.subtitle_text else clip.id,
            media_reference=media_ref,
            source_range=source_range,
            metadata={"mrdv2": {"is_subtitle_clip": True}},
        )

        otio_track.append(otio_clip)
        current_time = clip.timeline_end_sec

    return otio_track



# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def convert_to_otio(timeline: TimelineProject) -> otio.schema.Timeline:
    """Convert MrDV2 TimelineProject to an OTIO Timeline object."""
    rate = timeline.project.fps

    otio_timeline = otio.schema.Timeline(
        name=timeline.project.name,
        global_start_time=ot.RationalTime(0, rate),
        metadata={
            "mrdv2_version": timeline.version,
            "mrdv2_width": timeline.project.width,
            "mrdv2_height": timeline.project.height,
        },
    )

    for track in timeline.tracks:
        if track.muted:
            continue
        if track.type == "subtitle":
            otio_track = _convert_subtitle_track(track, timeline.media_pool, rate)
            otio_timeline.tracks.append(otio_track)
        elif track.type in ("video", "audio"):
            otio_track = _convert_track(track, timeline.media_pool, rate)
            otio_timeline.tracks.append(otio_track)

    return otio_timeline


def export_otio_file(timeline: TimelineProject, output_path: str) -> str:
    """Convert TimelineProject to OTIO JSON file. Returns the output path."""
    otio_tl = convert_to_otio(timeline)
    otio.adapters.write_to_file(otio_tl, output_path, adapter_name="otio_json")
    return output_path
