"""Timeline operations: get, create, manage, edit_clips, split_timeline."""

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


def _recompute_duration(clip: Clip) -> None:
    """Recompute duration_sec from source range and speed."""
    source_in = clip.source_in_sec or 0
    source_out = clip.source_out_sec
    if source_out is not None:
        clip.duration_sec = (source_out - source_in) / (clip.speed or 1.0)


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
    description="Get the full current timeline JSON including all clip details. "
    "Always call this before making modifications to understand current state.",
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
    description="Create a new timeline from scratch. Provide project metadata, media pool, and tracks with clips.",
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
                    _recompute_duration(clip)
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
    description="Manage timeline structure: add/remove tracks, add media to pool, update project settings. "
    "Operations: add_track, remove_track, add_media, set_project_meta.",
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
        "duration_sec": 0,  # will be recomputed
        "speed": speed,
    }
    # Optional fields
    for key in ("subtitle_text", "subtitle_style", "video_style"):
        if op.get(key) is not None:
            clip_data[key] = op[key]

    clip = Clip(**clip_data)
    _recompute_duration(clip)
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
    SCALAR_FIELDS = {"source_in_sec", "source_out_sec", "timeline_start_sec", "speed"}
    for field in SCALAR_FIELDS:
        if field in op:
            setattr(clip, field, float(op[field]) if op[field] is not None else None)

    # Updatable object/string fields
    if "subtitle_text" in op:
        clip.subtitle_text = op["subtitle_text"]

    if "subtitle_style" in op:
        style = op["subtitle_style"]
        clip.subtitle_style = SubtitleStyle(**style) if isinstance(style, dict) else style

    if "video_style" in op:
        style = op["video_style"]
        clip.video_style = VideoStyle(**style) if isinstance(style, dict) else style

    _recompute_duration(clip)
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


_OP_DISPATCH = {
    "add": _exec_add,
    "update": _exec_update,
    "delete": _exec_delete,
}


@registry.register(
    name="edit_clips",
    description="Add, update, or delete clips in a batch. Operations are applied sequentially; "
    "on error all changes are rolled back. "
    "Do NOT include split here — use split_timeline separately. "
    "duration_sec is auto-computed from source_in_sec, source_out_sec, and speed; do not pass it.",
    parameters={
        "type": "OBJECT",
        "properties": {
            "operations": {
                "type": "STRING",
                "description": "JSON array of operations. Each object must have an 'op' field: "
                "'add' — {op: 'add', track_id, type?, media_id?, source_in_sec, source_out_sec, timeline_start_sec, speed?, subtitle_text?, subtitle_style?, video_style?}. "
                "'update' — {op: 'update', clip_id, source_in_sec?, source_out_sec?, timeline_start_sec?, speed?, subtitle_text?, subtitle_style?, video_style?}. "
                "'delete' — {op: 'delete', clip_id}.",
            },
        },
        "required": ["operations"],
    },
)
async def edit_clips(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    operations, err = _parse_json_arg(args.get("operations", "[]"), "operations")
    if err:
        return err

    if not isinstance(operations, list) or len(operations) == 0:
        return {"error": "operations must be a non-empty array"}

    snapshot = deepcopy(state.current_timeline)
    results = []

    for i, op_item in enumerate(operations):
        op_type = op_item.get("op")
        handler = _OP_DISPATCH.get(op_type)
        if not handler:
            state.current_timeline = snapshot
            return {"error": f"Operation #{i}: unknown op '{op_type}'. Use add, update, or delete."}

        result = handler(state.current_timeline, op_item)
        if "error" in result:
            state.current_timeline = snapshot
            return {"error": f"Operation #{i} ({op_type}): {result['error']}", "failed_index": i}

        results.append({"index": i, "op": op_type, **result})

    return {"success": True, "applied": len(results), "results": results}


# ──────────────────────────────────────────────
# split_timeline — split by timeline time points
# ──────────────────────────────────────────────


@registry.register(
    name="split_timeline",
    description="Split clips at one or more timeline time points. "
    "If track_id is given, only clips on that track are split; "
    "otherwise ALL tracks are split. Returns new clip IDs for further editing.",
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


def _split_at_time(timeline: TimelineProject, split_at: float, track_id: str | None = None) -> list[dict]:
    """Split clips covering the given timeline time. If track_id is set, only that track is affected."""
    results = []

    tracks = timeline.tracks
    if track_id:
        tracks = [t for t in tracks if t.id == track_id]

    for track in tracks:
        # Collect clips to split (iterate over a copy since we modify the list)
        for clip in list(track.clips):
            clip_end = clip.timeline_start_sec + clip.duration_sec
            if clip.timeline_start_sec < split_at < clip_end:
                # Perform split
                offset = split_at - clip.timeline_start_sec
                speed = clip.speed or 1.0
                source_split = (clip.source_in_sec or 0) + offset * speed

                clip1 = deepcopy(clip)
                clip1.id = _gen_id("clip")
                clip1.source_out_sec = source_split
                _recompute_duration(clip1)

                clip2 = deepcopy(clip)
                clip2.id = _gen_id("clip")
                clip2.timeline_start_sec = split_at
                clip2.source_in_sec = source_split
                _recompute_duration(clip2)

                idx = track.clips.index(clip)
                track.clips[idx:idx + 1] = [clip1, clip2]

                results.append({
                    "track_id": track.id,
                    "original_clip_id": clip.id,
                    "clip_before": clip1.model_dump(),
                    "clip_after": clip2.model_dump(),
                })

    return results
