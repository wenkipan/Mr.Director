"""Time mapping tool: convert between timeline times and source media times."""

from __future__ import annotations

import json

from app.models.timeline import TimelineProject, Clip, Track
from app.tools.registry import registry


# ──────────────────────────────────────────────
# Layer 1: Pure utility functions
# ──────────────────────────────────────────────


def _clip_source_out(clip: Clip) -> float:
    if clip.source_out_sec is not None:
        return clip.source_out_sec
    duration = clip.timeline_end_sec - clip.timeline_start_sec
    return (clip.source_in_sec or 0) + duration * (clip.speed or 1.0)


def _media_path_by_id(timeline: TimelineProject, media_id: str) -> str | None:
    for m in timeline.media_pool:
        if m.id == media_id:
            return m.path
    return None


def _get_tracks(timeline: TimelineProject, track_id: str | None) -> list[Track]:
    if track_id:
        return [t for t in timeline.tracks if t.id == track_id]
    return timeline.tracks


def _compute_gaps(
    range_start: float, range_end: float, covered: list[tuple[float, float]]
) -> list[dict]:
    """Find uncovered sub-intervals within [range_start, range_end]."""
    if not covered:
        return [{"start_sec": round(range_start, 6), "end_sec": round(range_end, 6)}]

    sorted_intervals = sorted(covered, key=lambda x: x[0])
    merged = [list(sorted_intervals[0])]
    for start, end in sorted_intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    gaps = []
    cursor = range_start
    for start, end in merged:
        if cursor < start:
            gaps.append({"start_sec": round(cursor, 6), "end_sec": round(start, 6)})
        cursor = max(cursor, end)
    if cursor < range_end:
        gaps.append({"start_sec": round(cursor, 6), "end_sec": round(range_end, 6)})

    return gaps


def map_point_timeline_to_source(
    timeline: TimelineProject,
    time_sec: float,
    track_id: str | None = None,
) -> list[dict]:
    """Map a single timeline time to source time(s).

    Returns a list because multiple tracks may have clips at that time.
    """
    results = []
    for track in _get_tracks(timeline, track_id):
        for clip in track.clips:
            clip_end = clip.timeline_end_sec
            if clip.timeline_start_sec <= time_sec < clip_end:
                speed = clip.speed or 1.0
                source_in = clip.source_in_sec or 0
                source_time = source_in + (time_sec - clip.timeline_start_sec) * speed
                results.append({
                    "track_id": track.id,
                    "track_type": track.type,
                    "clip_id": clip.id,
                    "media_id": clip.media_id,
                    "media_path": _media_path_by_id(timeline, clip.media_id) if clip.media_id else None,
                    "source_time_sec": round(source_time, 6),
                    "speed": speed,
                })
    return results


def map_range_timeline_to_source(
    timeline: TimelineProject,
    start_sec: float,
    end_sec: float,
    track_id: str | None = None,
) -> dict:
    """Map a timeline time range to source ranges.

    Returns mappings and gaps (uncovered timeline intervals).
    """
    mappings = []
    covered_intervals: list[tuple[float, float]] = []

    for track in _get_tracks(timeline, track_id):
        for clip in track.clips:
            clip_start = clip.timeline_start_sec
            clip_end = clip.timeline_end_sec

            if start_sec < clip_end and end_sec > clip_start:
                speed = clip.speed or 1.0
                source_in = clip.source_in_sec or 0

                eff_start = max(start_sec, clip_start)
                eff_end = min(end_sec, clip_end)

                src_start = source_in + (eff_start - clip_start) * speed
                src_end = source_in + (eff_end - clip_start) * speed

                mappings.append({
                    "track_id": track.id,
                    "track_type": track.type,
                    "clip_id": clip.id,
                    "media_id": clip.media_id,
                    "media_path": _media_path_by_id(timeline, clip.media_id) if clip.media_id else None,
                    "source_start_sec": round(src_start, 6),
                    "source_end_sec": round(src_end, 6),
                    "timeline_start_sec": round(eff_start, 6),
                    "timeline_end_sec": round(eff_end, 6),
                    "speed": speed,
                })
                covered_intervals.append((eff_start, eff_end))

    gaps = _compute_gaps(start_sec, end_sec, covered_intervals)
    return {"mappings": mappings, "gaps": gaps}


def map_point_source_to_timeline(
    timeline: TimelineProject,
    media_id: str,
    source_time_sec: float,
) -> list[dict]:
    """Map a single source time for a given media to timeline time(s).

    Returns a list because the same source region may appear in multiple clips.
    """
    results = []
    for track in timeline.tracks:
        for clip in track.clips:
            if clip.media_id != media_id:
                continue
            source_in = clip.source_in_sec or 0
            source_out = _clip_source_out(clip)
            if source_in <= source_time_sec < source_out:
                speed = clip.speed or 1.0
                tl_time = clip.timeline_start_sec + (source_time_sec - source_in) / speed
                results.append({
                    "track_id": track.id,
                    "track_type": track.type,
                    "clip_id": clip.id,
                    "timeline_time_sec": round(tl_time, 6),
                    "speed": speed,
                })
    return results


def map_range_source_to_timeline(
    timeline: TimelineProject,
    media_id: str,
    source_start_sec: float,
    source_end_sec: float,
) -> dict:
    """Map a source time range to timeline ranges.

    Returns mappings and unmapped_ranges (source intervals not used in any clip).
    """
    mappings = []
    covered_intervals: list[tuple[float, float]] = []

    for track in timeline.tracks:
        for clip in track.clips:
            if clip.media_id != media_id:
                continue
            source_in = clip.source_in_sec or 0
            source_out = _clip_source_out(clip)

            if source_start_sec < source_out and source_end_sec > source_in:
                speed = clip.speed or 1.0

                eff_src_start = max(source_start_sec, source_in)
                eff_src_end = min(source_end_sec, source_out)

                tl_start = clip.timeline_start_sec + (eff_src_start - source_in) / speed
                tl_end = clip.timeline_start_sec + (eff_src_end - source_in) / speed

                mappings.append({
                    "track_id": track.id,
                    "track_type": track.type,
                    "clip_id": clip.id,
                    "timeline_start_sec": round(tl_start, 6),
                    "timeline_end_sec": round(tl_end, 6),
                    "source_start_sec": round(eff_src_start, 6),
                    "source_end_sec": round(eff_src_end, 6),
                    "speed": speed,
                })
                covered_intervals.append((eff_src_start, eff_src_end))

    unmapped = _compute_gaps(source_start_sec, source_end_sec, covered_intervals)
    return {"mappings": mappings, "unmapped_ranges": unmapped}


# ──────────────────────────────────────────────
# Layer 2: Registered agent tool
# ──────────────────────────────────────────────


@registry.register(
    name="map_time",
    description=(
        "Convert between timeline times and source media times (bidirectional, batch-capable). "
        "'timeline_to_source': given timeline position(s), find which clip(s) are playing "
        "and return the corresponding source media times. "
        "'source_to_timeline': given a media_id and source time(s) (e.g. ASR timestamps), "
        "find where they appear on the timeline. "
        "\n\nWhen to use: correlating ASR/transcript timestamps (source time) with timeline positions, "
        "answering 'what is playing at timeline position X?', finding where a transcript moment appears in the edit. "
        "MANDATORY when working with ASR timestamps after any cuts or rearrangements — "
        "source times and timeline times are almost never equal after editing. "
        "When NOT to use: the timeline has not been edited yet and clips start at source_in_sec=0 with no cuts."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "direction": {
                "type": "STRING",
                "description": (
                    "Conversion direction: 'timeline_to_source' or 'source_to_timeline'"
                ),
            },
            "queries": {
                "type": "STRING",
                "description": (
                    "JSON array of query objects. "
                    "For timeline_to_source: [{\"time_sec\": 10.0}] for point query, "
                    "or [{\"start_sec\": 10.0, \"end_sec\": 12.0}] for range query. "
                    "Optionally include \"track_id\" to limit to a specific track. "
                    "For source_to_timeline: [{\"media_id\": \"vid1\", \"time_sec\": 30.0}] "
                    "or [{\"media_id\": \"vid1\", \"start_sec\": 30.0, \"end_sec\": 32.0}]."
                ),
            },
        },
        "required": ["direction", "queries"],
    },
)
async def map_time(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    direction = args.get("direction", "")
    if direction not in ("timeline_to_source", "source_to_timeline"):
        return {"error": "direction must be 'timeline_to_source' or 'source_to_timeline'"}

    raw = args.get("queries", "[]")
    try:
        queries = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as e:
        return {"error": f"Invalid queries JSON: {e}"}

    if not isinstance(queries, list) or len(queries) == 0:
        return {"error": "queries must be a non-empty array"}

    timeline = state.current_timeline
    results = []

    for q in queries:
        if direction == "timeline_to_source":
            result = _process_tl_to_src_query(timeline, q)
        else:
            result = _process_src_to_tl_query(timeline, q)
        results.append({"query": q, **result})

    return {"success": True, "direction": direction, "results": results}


def _process_tl_to_src_query(timeline: TimelineProject, q: dict) -> dict:
    track_id = q.get("track_id")
    if "start_sec" in q and "end_sec" in q:
        return map_range_timeline_to_source(
            timeline, q["start_sec"], q["end_sec"], track_id
        )
    elif "time_sec" in q:
        mappings = map_point_timeline_to_source(timeline, q["time_sec"], track_id)
        return {"mappings": mappings}
    else:
        return {"error": "Query must have 'time_sec' or both 'start_sec' and 'end_sec'"}


def _process_src_to_tl_query(timeline: TimelineProject, q: dict) -> dict:
    media_id = q.get("media_id")
    if not media_id:
        return {"error": "source_to_timeline queries require 'media_id'"}
    if not any(m.id == media_id for m in timeline.media_pool):
        return {"error": f"Media not found in media_pool: {media_id}"}

    if "start_sec" in q and "end_sec" in q:
        return map_range_source_to_timeline(
            timeline, media_id, q["start_sec"], q["end_sec"]
        )
    elif "time_sec" in q:
        mappings = map_point_source_to_timeline(timeline, media_id, q["time_sec"])
        return {"mappings": mappings}
    else:
        return {"error": "Query must have 'time_sec' or both 'start_sec' and 'end_sec'"}
