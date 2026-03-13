"""Timeline operations: get, create, manage, add/update/delete/move clips, split, remove_gap."""

from __future__ import annotations

import json
import uuid
from copy import deepcopy

from app.models.timeline import TimelineProject, Track, Clip, MediaAsset, ProjectMeta
from app.tools.registry import registry


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _gen_id(prefix: str = "clip") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _find_track(timeline: TimelineProject, track_id: str) -> Track | None:
    for track in timeline.tracks:
        if track.id == track_id:
            return track
    return None


def _find_clip_global(timeline: TimelineProject, clip_id: str) -> tuple[Track, Clip] | None:
    """Find a clip by ID across all tracks. Returns (track, clip) or None."""
    for track in timeline.tracks:
        for clip in track.clips:
            if clip.id == clip_id:
                return track, clip
    return None


def _recompute_end(clip: Clip) -> None:
    """Recompute timeline_end_sec from source range, speed, and timeline_start_sec."""
    source_in = clip.source_in_sec or 0
    source_out = clip.source_out_sec
    if source_out is not None:
        duration = (source_out - source_in) / (clip.speed or 1.0)
        clip.timeline_end_sec = clip.timeline_start_sec + duration


def _parse_json_arg(raw, field_name: str = "arg") -> tuple[object, dict | None]:
    """Parse a JSON string or pass through a dict/list. Returns (parsed, error_dict)."""
    if isinstance(raw, str):
        try:
            return json.loads(raw), None
        except json.JSONDecodeError as e:
            return None, {"error": f"Invalid {field_name} JSON: {e}"}
    return raw, None


# ──────────────────────────────────────────────
# get_timeline (unchanged)
# ──────────────────────────────────────────────


@registry.register(
    name="get_timeline",
    description=(
        "Retrieve the full current timeline JSON — all tracks, clips, media_pool, and project metadata. "
        "\n\nWhen to use: BEFORE any modification to confirm clip IDs, positions, and current state. "
        "When NOT to use: you just created or modified the timeline in this same turn and already have the state."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {},
    },
)
async def get_timeline(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}
    return {
        "project_id": state.project_id,
        "timeline": state.current_timeline.model_dump(),
    }


# ──────────────────────────────────────────────
# create_timeline (unchanged)
# ──────────────────────────────────────────────


@registry.register(
    name="create_timeline",
    description=(
        "Create a brand-new timeline with project settings, media_pool, and initial tracks/clips. "
        "Replaces any existing timeline for this project. "
        "\n\nWhen to use: starting a new edit from scratch. "
        "When NOT to use: timeline already exists and you want to modify it (use add_clips/update_clips/etc)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING", "description": "Project name"},
            "width": {"type": "INTEGER", "description": "Video width in pixels, default 1920"},
            "height": {"type": "INTEGER", "description": "Video height in pixels, default 1080"},
            "fps": {"type": "NUMBER", "description": "Frames per second, default 30"},
            "media_pool": {
                "type": "STRING",
                "description": "JSON array of media assets: [{id, path, type, duration_sec, width, height}]",
            },
            "tracks": {
                "type": "STRING",
                "description": "JSON array of tracks: [{id, name, type, clips: [{id, type, media_id, source_in_sec, source_out_sec, timeline_start_sec, speed, subtitle_text, subtitle_style, video_style}]}]",
            },
        },
        "required": ["name"],
    },
)
async def create_timeline(args: dict, state) -> dict:
    name = args.get("name", "Untitled")
    width = int(args.get("width", 1920))
    height = int(args.get("height", 1080))
    fps = float(args.get("fps", 30))

    media_pool = []
    if args.get("media_pool"):
        raw, err = _parse_json_arg(args["media_pool"], "media_pool")
        if err:
            return err
        try:
            media_pool = [MediaAsset(**m) for m in raw]
        except Exception as e:
            return {"error": f"Invalid media_pool: {e}"}

    tracks = []
    if args.get("tracks"):
        raw, err = _parse_json_arg(args["tracks"], "tracks")
        if err:
            return err
        try:
            for t in raw:
                clips_raw = t.pop("clips", [])
                clips = []
                for c in clips_raw:
                    clip = Clip(**c)
                    _recompute_end(clip)
                    clips.append(clip)
                tracks.append(Track(**t, clips=clips))
        except Exception as e:
            return {"error": f"Invalid tracks: {e}"}

    timeline = TimelineProject(
        version="1.0.0",
        project=ProjectMeta(name=name, width=width, height=height, fps=fps),
        media_pool=media_pool,
        tracks=tracks,
    )

    state.current_timeline = timeline
    return {"success": True, "timeline": timeline.model_dump()}


# ──────────────────────────────────────────────
# manage_timeline — track / media / meta ops
# ──────────────────────────────────────────────


@registry.register(
    name="manage_timeline",
    description=(
        "Manage non-clip timeline structure: add/remove tracks, register media in the pool, "
        "update project settings (resolution, fps, name). "
        "Operations: add_track, remove_track, add_media, set_project_meta. "
        "\n\nWhen to use: adding a new track before placing clips, registering a media file, "
        "changing project resolution/fps. "
        "When NOT to use: adding/editing/deleting clips (use add_clips/update_clips/delete_clips)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "operation": {
                "type": "STRING",
                "description": "One of: add_track, remove_track, add_media, set_project_meta",
            },
            "params": {
                "type": "STRING",
                "description": "JSON object. "
                "add_track: {id?, name?, type}. "
                "remove_track: {track_id}. "
                "add_media: {id, path, type, duration_sec?, width?, height?}. "
                "set_project_meta: {name?, width?, height?, fps?}.",
            },
        },
        "required": ["operation", "params"],
    },
)
async def manage_timeline(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    op = args["operation"]
    params, err = _parse_json_arg(args.get("params", "{}"), "params")
    if err:
        return err

    timeline = state.current_timeline

    if op == "add_media":
        asset = MediaAsset(**params)
        timeline.media_pool.append(asset)
        return {"success": True, "added_media": asset.model_dump()}

    elif op == "set_project_meta":
        for key, val in params.items():
            if hasattr(timeline.project, key):
                setattr(timeline.project, key, val)
        return {"success": True, "project": timeline.project.model_dump()}

    elif op == "add_track":
        track = Track(
            id=params.get("id", _gen_id("track")),
            name=params.get("name"),
            type=params["type"],
            clips=[],
        )
        timeline.tracks.append(track)
        return {"success": True, "added_track": track.model_dump()}

    elif op == "remove_track":
        track_id = params["track_id"]
        timeline.tracks = [t for t in timeline.tracks if t.id != track_id]
        return {"success": True, "removed_track": track_id}

    else:
        return {"error": f"Unknown operation: {op}. Use add_track, remove_track, add_media, or set_project_meta."}


# ──────────────────────────────────────────────
# edit_clips — add / update / delete (batch)
# ──────────────────────────────────────────────


def _exec_add(timeline: TimelineProject, op: dict) -> dict:
    track_id = op.get("track_id")
    if not track_id:
        return {"error": "add: missing track_id"}

    track = _find_track(timeline, track_id)
    if not track:
        return {"error": f"add: track not found: {track_id}"}

    clip_type = op.get("type", track.type)
    source_in = float(op.get("source_in_sec", 0))
    source_out_raw = op.get("source_out_sec")
    source_out = float(source_out_raw) if source_out_raw is not None else None
    timeline_start = float(op.get("timeline_start_sec", 0))
    speed = float(op.get("speed", 1.0))

    # Build clip
    clip_data = {
        "id": _gen_id("clip"),
        "type": clip_type,
        "media_id": op.get("media_id"),
        "source_in_sec": source_in,
        "source_out_sec": source_out,
        "timeline_start_sec": timeline_start,
        "timeline_end_sec": timeline_start,  # will be recomputed
        "speed": speed,
    }
    # Optional fields
    for key in ("volume", "subtitle_text", "subtitle_style_ref", "subtitle_style", "video_style"):
        if op.get(key) is not None:
            clip_data[key] = op[key]
    # Default style ref for subtitle clips
    if clip_type == "subtitle" and not clip_data.get("subtitle_style_ref"):
        clip_data["subtitle_style_ref"] = "default"

    clip = Clip(**clip_data)
    _recompute_end(clip)
    track.clips.append(clip)
    track.clips.sort(key=lambda c: c.timeline_start_sec)
    return {"success": True, "clip": clip.model_dump()}


def _exec_update(timeline: TimelineProject, op: dict) -> dict:
    from app.models.timeline import SubtitleStyle, VideoStyle

    clip_id = op.get("clip_id")
    if not clip_id:
        return {"error": "update: missing clip_id"}

    found = _find_clip_global(timeline, clip_id)
    if not found:
        return {"error": f"update: clip not found: {clip_id}"}

    track, clip = found

    # Updatable scalar fields
    SCALAR_FIELDS = {"source_in_sec", "source_out_sec", "timeline_start_sec", "timeline_end_sec", "speed", "volume"}
    for field in SCALAR_FIELDS:
        if field in op:
            setattr(clip, field, float(op[field]) if op[field] is not None else None)

    # Updatable object/string fields
    if "subtitle_text" in op:
        clip.subtitle_text = op["subtitle_text"]

    if "subtitle_style_ref" in op:
        clip.subtitle_style_ref = op["subtitle_style_ref"]

    if "subtitle_style" in op:
        style = op["subtitle_style"]
        clip.subtitle_style = SubtitleStyle(**style) if isinstance(style, dict) else style

    if "video_style" in op:
        style = op["video_style"]
        clip.video_style = VideoStyle(**style) if isinstance(style, dict) else style

    _recompute_end(clip)
    track.clips.sort(key=lambda c: c.timeline_start_sec)
    return {"success": True, "clip": clip.model_dump()}


def _exec_delete(timeline: TimelineProject, op: dict) -> dict:
    clip_id = op.get("clip_id")
    if not clip_id:
        return {"error": "delete: missing clip_id"}

    found = _find_clip_global(timeline, clip_id)
    if not found:
        return {"error": f"delete: clip not found: {clip_id}"}

    track, clip = found
    track.clips = [c for c in track.clips if c.id != clip_id]
    return {"success": True, "deleted_clip": clip_id}


def _exec_move(timeline: TimelineProject, op: dict) -> dict:
    """Batch-move clips by a time offset. Accepts clip_ids or track_id."""
    delta = op.get("delta_sec")
    if delta is None:
        return {"error": "move: missing delta_sec"}
    delta = float(delta)

    clip_ids = op.get("clip_ids")
    track_id = op.get("track_id")

    if not clip_ids and not track_id:
        return {"error": "move: must provide clip_ids or track_id"}

    # Collect target clips
    targets: list[tuple[Track, Clip]] = []
    if clip_ids:
        for cid in clip_ids:
            found = _find_clip_global(timeline, cid)
            if not found:
                return {"error": f"move: clip not found: {cid}"}
            targets.append(found)
    else:
        track = _find_track(timeline, track_id)
        if not track:
            return {"error": f"move: track not found: {track_id}"}
        targets = [(track, clip) for clip in track.clips]

    if not targets:
        return {"error": "move: no clips to move"}

    # Check no clip goes negative
    for _, clip in targets:
        new_start = clip.timeline_start_sec + delta
        if new_start < 0:
            return {"error": f"move: clip {clip.id} would start at {new_start:.3f}s (< 0)"}

    # Apply
    moved = []
    affected_tracks: set[str] = set()
    for track, clip in targets:
        clip.timeline_start_sec += delta
        clip.timeline_end_sec += delta
        moved.append(clip.id)
        affected_tracks.add(track.id)

    # Re-sort affected tracks
    for track in timeline.tracks:
        if track.id in affected_tracks:
            track.clips.sort(key=lambda c: c.timeline_start_sec)

    return {"success": True, "moved_clips": moved, "delta_sec": delta}


def _batch_execute(state, items: list, handler) -> dict:
    """Run a batch of same-type operations with snapshot rollback on error."""
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}
    if not isinstance(items, list) or len(items) == 0:
        return {"error": "items must be a non-empty array"}

    snapshot = deepcopy(state.current_timeline)
    results = []
    for i, item in enumerate(items):
        result = handler(state.current_timeline, item)
        if "error" in result:
            state.current_timeline = snapshot
            return {"error": f"Item #{i}: {result['error']}", "failed_index": i}
        results.append({"index": i, **result})
    return {"success": True, "applied": len(results), "results": results}


# ──────────────────────────────────────────────
# add_clips
# ──────────────────────────────────────────────


@registry.register(
    name="add_clips",
    description=(
        "Add one or more new clips to the timeline. Supports batch — pass an array of clip definitions. "
        "On error, ALL additions are rolled back (atomic). "
        "\n\ntimeline_end_sec is auto-computed for media clips from (source_out_sec - source_in_sec) / speed + timeline_start_sec. "
        "For subtitle clips (no media_id), provide timeline_end_sec explicitly. "
        "\n\nWhen to use: placing new footage, images, or subtitles on the timeline. "
        "When NOT to use: modifying existing clips (use update_clips), repositioning clips (use move_clips)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "clips": {
                "type": "STRING",
                "description": (
                    "JSON array of clip objects to add. Each object: "
                    "{track_id, media_id?, type?, source_in_sec, source_out_sec, timeline_start_sec, "
                    "speed? (default 1.0), subtitle_text?, subtitle_style_ref?, subtitle_style?, video_style?}. "
                    "For subtitle clips: omit media_id, provide subtitle_text and timeline_end_sec."
                ),
            },
        },
        "required": ["clips"],
    },
)
async def add_clips(args: dict, state) -> dict:
    items, err = _parse_json_arg(args.get("clips", "[]"), "clips")
    if err:
        return err
    return _batch_execute(state, items, _exec_add)


# ──────────────────────────────────────────────
# update_clips
# ──────────────────────────────────────────────


@registry.register(
    name="update_clips",
    description=(
        "Update properties of one or more existing clips. Only pass the fields you want to change — "
        "unspecified fields are left untouched. Supports batch. Atomic rollback on error. "
        "timeline_end_sec is auto-recomputed when source_in_sec, source_out_sec, or speed change. "
        "\n\nWhen to use: trimming (source_in/out), changing speed, editing subtitle text/style, "
        "adjusting video_style (crop, opacity, PiP position). "
        "When NOT to use: shifting clip position on the timeline (use move_clips), "
        "removing clips (use delete_clips)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "clips": {
                "type": "STRING",
                "description": (
                    "JSON array of update objects. Each object: "
                    "{clip_id, source_in_sec?, source_out_sec?, timeline_start_sec?, "
                    "timeline_end_sec?, speed?, subtitle_text?, subtitle_style_ref?, "
                    "subtitle_style?, video_style?}. "
                    "clip_id is required; all other fields are optional."
                ),
            },
        },
        "required": ["clips"],
    },
)
async def update_clips(args: dict, state) -> dict:
    items, err = _parse_json_arg(args.get("clips", "[]"), "clips")
    if err:
        return err
    return _batch_execute(state, items, _exec_update)


# ──────────────────────────────────────────────
# delete_clips
# ──────────────────────────────────────────────


@registry.register(
    name="delete_clips",
    description=(
        "Delete one or more clips from the timeline by clip_id. Supports batch. Atomic rollback on error. "
        "Clips are looked up globally — no track_id needed. "
        "\n\nWhen to use: removing unwanted clips. "
        "When NOT to use: if you need to close the gap left behind, call remove_gap after deleting. "
        "If you want to replace a clip, consider update_clips instead of delete + add."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "clip_ids": {
                "type": "STRING",
                "description": "JSON array of clip IDs to delete. Example: [\"clip_abc123\", \"clip_def456\"].",
            },
        },
        "required": ["clip_ids"],
    },
)
async def delete_clips(args: dict, state) -> dict:
    raw, err = _parse_json_arg(args.get("clip_ids", "[]"), "clip_ids")
    if err:
        return err
    items = [{"clip_id": cid} for cid in raw]
    return _batch_execute(state, items, _exec_delete)


# ──────────────────────────────────────────────
# move_clips
# ──────────────────────────────────────────────


@registry.register(
    name="move_clips",
    description=(
        "Shift one or more clips in time by a delta offset. All specified clips move by the same amount. "
        "Positive delta = shift right (later), negative = shift left (earlier). "
        "\n\nWhen to use: closing gaps between clips, making room for inserts, "
        "shifting a group of clips together (e.g. all clips after a certain point). "
        "When NOT to use: repositioning a single clip to an exact position "
        "(use update_clips with timeline_start_sec instead)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "delta_sec": {
                "type": "NUMBER",
                "description": "Time offset in seconds. Positive = shift right/later, negative = shift left/earlier.",
            },
            "clip_ids": {
                "type": "STRING",
                "description": "JSON array of clip IDs to move. Provide this OR track_id, not both.",
            },
            "track_id": {
                "type": "STRING",
                "description": "Move ALL clips on this track. Provide this OR clip_ids, not both.",
            },
        },
        "required": ["delta_sec"],
    },
)
async def move_clips(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    op = {"delta_sec": args.get("delta_sec")}
    if args.get("clip_ids"):
        raw, err = _parse_json_arg(args["clip_ids"], "clip_ids")
        if err:
            return err
        op["clip_ids"] = raw
    if args.get("track_id"):
        op["track_id"] = args["track_id"]

    snapshot = deepcopy(state.current_timeline)
    result = _exec_move(state.current_timeline, op)
    if "error" in result:
        state.current_timeline = snapshot
    return result


# ──────────────────────────────────────────────
# split_timeline — split by timeline time points
# ──────────────────────────────────────────────


@registry.register(
    name="split_timeline",
    description=(
        "Split clips at one or more timeline time points. Returns new clip IDs for further editing. "
        "If track_id is given, only that track is affected; otherwise ALL tracks are split. "
        "\n\nWhen to use: you need to cut a clip into two pieces before deleting/updating one half. "
        "Always call this BEFORE delete_clips/update_clips when you need to work with a sub-range of an existing clip. "
        "When NOT to use: removing a whole clip (just delete_clips), trimming from the edges (update_clips with source_in/out)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "split_points": {
                "type": "STRING",
                "description": "JSON array of timeline times (seconds) at which to cut. "
                "Example: [15.0, 30.0].",
            },
            "track_id": {
                "type": "STRING",
                "description": "Optional. If provided, only split clips on this track.",
            },
        },
        "required": ["split_points"],
    },
)
async def split_timeline(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    raw, err = _parse_json_arg(args.get("split_points", "[]"), "split_points")
    if err:
        return err

    if not isinstance(raw, list) or len(raw) == 0:
        return {"error": "split_points must be a non-empty array of numbers"}

    try:
        split_points = sorted(float(p) for p in raw)
    except (TypeError, ValueError) as e:
        return {"error": f"split_points must be numbers: {e}"}

    track_id = args.get("track_id")
    if track_id and not _find_track(state.current_timeline, track_id):
        return {"error": f"Track not found: {track_id}"}

    snapshot = deepcopy(state.current_timeline)
    all_splits = []

    for point in split_points:
        splits_at_point = _split_at_time(state.current_timeline, point, track_id)
        if splits_at_point:
            all_splits.append({"split_at_sec": point, "splits": splits_at_point})

    if not all_splits:
        state.current_timeline = snapshot
        return {"error": "No clips found at any of the given split points"}

    return {"success": True, "results": all_splits}


GAP_EPSILON = 1e-6


def _find_gap_on_track(track: Track, gap_start: float, gap_end: float) -> str | None:
    """Verify that [gap_start, gap_end] is a real gap on the track.
    Returns an error message if it's not a gap, or None if valid."""
    if gap_end - gap_start <= GAP_EPSILON:
        return f"gap duration too small: {gap_end - gap_start:.6f}s"
    sorted_clips = sorted(track.clips, key=lambda c: c.timeline_start_sec)
    for clip in sorted_clips:
        # A clip overlaps the gap if clip_start < gap_end and clip_end > gap_start
        if clip.timeline_start_sec < gap_end - GAP_EPSILON and clip.timeline_end_sec > gap_start + GAP_EPSILON:
            return f"clip '{clip.id}' overlaps the specified gap [{gap_start:.3f}, {gap_end:.3f}]"
    return None


@registry.register(
    name="remove_gap",
    description=(
        "Remove a gap (empty space) on the timeline by shifting all subsequent clips backward. "
        "Validates that the range is actually empty (no clips). "
        "If track_id is given, only that track; otherwise all non-locked tracks. "
        "\n\nWhen to use: after delete_clips leaves a gap you want to close. "
        "When NOT to use: to shift specific clips (use move_clips with a negative delta instead)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "gap_start_sec": {
                "type": "NUMBER",
                "description": "Start time of the gap in seconds.",
            },
            "gap_end_sec": {
                "type": "NUMBER",
                "description": "End time of the gap in seconds.",
            },
            "track_id": {
                "type": "STRING",
                "description": "Optional. If provided, only remove the gap on this track. "
                "If omitted, all non-locked tracks are affected.",
            },
        },
        "required": ["gap_start_sec", "gap_end_sec"],
    },
)
async def remove_gap(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    gap_start = float(args["gap_start_sec"])
    gap_end = float(args["gap_end_sec"])
    track_id = args.get("track_id")
    gap_duration = gap_end - gap_start

    if gap_duration <= GAP_EPSILON:
        return {"error": f"Invalid gap: gap_end_sec ({gap_end}) must be greater than gap_start_sec ({gap_start})"}

    timeline = state.current_timeline
    snapshot = deepcopy(timeline)

    if track_id:
        # Single track mode
        track = _find_track(timeline, track_id)
        if not track:
            return {"error": f"Track not found: {track_id}"}
        if track.locked:
            return {"error": f"Track '{track_id}' is locked"}

        err = _find_gap_on_track(track, gap_start, gap_end)
        if err:
            state.current_timeline = snapshot
            return {"error": f"Not a valid gap on track '{track_id}': {err}"}

        moved = []
        for clip in track.clips:
            if clip.timeline_start_sec >= gap_start + GAP_EPSILON:
                clip.timeline_start_sec -= gap_duration
                clip.timeline_end_sec -= gap_duration
                moved.append(clip.id)
        track.clips.sort(key=lambda c: c.timeline_start_sec)

        return {"success": True, "track_id": track_id, "gap_removed_sec": gap_duration, "moved_clips": moved}
    else:
        # All tracks mode: validate gap exists on at least one track, then shift all non-locked tracks
        has_gap = False
        for track in timeline.tracks:
            if track.locked or len(track.clips) == 0:
                continue
            err = _find_gap_on_track(track, gap_start, gap_end)
            if err is None:
                has_gap = True
            elif err and "overlaps" in err:
                # Track has a clip in this range — that's fine, it just means this track has no gap here
                pass

        if not has_gap:
            state.current_timeline = snapshot
            return {"error": f"No track has a valid gap at [{gap_start:.3f}, {gap_end:.3f}]"}

        moved_all = {}
        for track in timeline.tracks:
            if track.locked:
                continue
            moved = []
            for clip in track.clips:
                if clip.timeline_start_sec >= gap_start + GAP_EPSILON:
                    clip.timeline_start_sec -= gap_duration
                    clip.timeline_end_sec -= gap_duration
                    moved.append(clip.id)
            track.clips.sort(key=lambda c: c.timeline_start_sec)
            if moved:
                moved_all[track.id] = moved

        return {"success": True, "mode": "all_tracks", "gap_removed_sec": gap_duration, "moved_clips": moved_all}


def _split_at_time(timeline: TimelineProject, split_at: float, track_id: str | None = None) -> list[dict]:
    """Split clips covering the given timeline time. If track_id is set, only that track is affected."""
    results = []

    tracks = timeline.tracks
    if track_id:
        tracks = [t for t in tracks if t.id == track_id]

    for track in tracks:
        # Collect clips to split (iterate over a copy since we modify the list)
        for clip in list(track.clips):
            if clip.timeline_start_sec < split_at < clip.timeline_end_sec:
                # Perform split
                offset = split_at - clip.timeline_start_sec
                speed = clip.speed or 1.0
                source_split = (clip.source_in_sec or 0) + offset * speed

                clip1 = deepcopy(clip)
                clip1.id = _gen_id("clip")
                clip1.source_out_sec = source_split
                clip1.timeline_end_sec = split_at
                _recompute_end(clip1)

                clip2 = deepcopy(clip)
                clip2.id = _gen_id("clip")
                clip2.timeline_start_sec = split_at
                clip2.source_in_sec = source_split
                _recompute_end(clip2)

                idx = track.clips.index(clip)
                track.clips[idx:idx + 1] = [clip1, clip2]

                results.append({
                    "track_id": track.id,
                    "original_clip_id": clip.id,
                    "clip_before": clip1.model_dump(),
                    "clip_after": clip2.model_dump(),
                })

    return results
