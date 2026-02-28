"""Timeline operations: get_timeline, create_timeline, modify_timeline."""

from __future__ import annotations

import uuid
from copy import deepcopy

from app.models.timeline import TimelineProject, Track, Clip, MediaAsset, ProjectMeta
from app.tools.registry import registry


def _gen_id(prefix: str = "clip") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@registry.register(
    name="get_timeline",
    description="Get the full current timeline JSON including all clip details "
    "(source_in_sec, source_out_sec, speed, video_style, subtitle_text, etc.). "
    "Use this when you need precise clip properties before making modifications. "
    "The system prompt only shows a summary.",
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
                "description": "JSON array of tracks: [{id, name, type, clips: [{id, type, media_id, source_in_sec, source_out_sec, timeline_start_sec, duration_sec, speed, subtitle_text, subtitle_style, video_style}]}]",
            },
        },
        "required": ["name"],
    },
)
async def create_timeline(args: dict, state) -> dict:
    import json

    name = args.get("name", "Untitled")
    width = int(args.get("width", 1920))
    height = int(args.get("height", 1080))
    fps = float(args.get("fps", 30))

    media_pool = []
    if args.get("media_pool"):
        try:
            raw = json.loads(args["media_pool"]) if isinstance(args["media_pool"], str) else args["media_pool"]
            media_pool = [MediaAsset(**m) for m in raw]
        except Exception as e:
            return {"error": f"Invalid media_pool: {e}"}

    tracks = []
    if args.get("tracks"):
        try:
            raw = json.loads(args["tracks"]) if isinstance(args["tracks"], str) else args["tracks"]
            for t in raw:
                clips_raw = t.pop("clips", [])
                clips = [Clip(**c) for c in clips_raw]
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


@registry.register(
    name="modify_timeline",
    description="Apply an operation to the current timeline. Operations: "
    "add_track, remove_track, add_clip, remove_clip, modify_clip, "
    "split_clip, add_media, set_project_meta.",
    parameters={
        "type": "OBJECT",
        "properties": {
            "operation": {
                "type": "STRING",
                "description": "One of: add_track, remove_track, add_clip, remove_clip, modify_clip, split_clip, add_media, set_project_meta",
            },
            "params": {
                "type": "STRING",
                "description": "JSON object with operation-specific parameters. "
                "add_track: {id, name, type}. "
                "remove_track: {track_id}. "
                "add_clip: {track_id, clip: {id, type, media_id, source_in_sec, source_out_sec, timeline_start_sec, duration_sec, speed, subtitle_text, subtitle_style, video_style}}. "
                "remove_clip: {track_id, clip_id}. "
                "modify_clip: {track_id, clip_id, updates: {field: value, ...}}. subtitle_style: {position_x, position_y, font_family, font_size, color, background, text_align, bold, italic}. video_style: {position_x, position_y, width, height, opacity, fit, crop_left, crop_top, crop_right, crop_bottom, border_radius}. "
                "split_clip: {track_id, clip_id, split_at_sec (timeline time)}. "
                "add_media: {id, path, type, duration_sec, width, height}. "
                "set_project_meta: {name, width, height, fps}.",
            },
        },
        "required": ["operation", "params"],
    },
)
async def modify_timeline(args: dict, state) -> dict:
    import json

    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    op = args["operation"]
    try:
        params = json.loads(args["params"]) if isinstance(args["params"], str) else args["params"]
    except json.JSONDecodeError as e:
        return {"error": f"Invalid params JSON: {e}"}

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

    elif op == "add_clip":
        track = _find_track(timeline, params["track_id"])
        if not track:
            return {"error": f"Track not found: {params['track_id']}"}
        clip_data = params["clip"]
        if "id" not in clip_data:
            clip_data["id"] = _gen_id("clip")
        clip = Clip(**clip_data)
        track.clips.append(clip)
        track.clips.sort(key=lambda c: c.timeline_start_sec)
        return {"success": True, "added_clip": clip.model_dump()}

    elif op == "remove_clip":
        track = _find_track(timeline, params["track_id"])
        if not track:
            return {"error": f"Track not found: {params['track_id']}"}
        track.clips = [c for c in track.clips if c.id != params["clip_id"]]
        return {"success": True, "removed_clip": params["clip_id"]}

    elif op == "modify_clip":
        track = _find_track(timeline, params["track_id"])
        if not track:
            return {"error": f"Track not found: {params['track_id']}"}
        clip = _find_clip(track, params["clip_id"])
        if not clip:
            return {"error": f"Clip not found: {params['clip_id']}"}
        for key, val in params.get("updates", {}).items():
            if hasattr(clip, key):
                setattr(clip, key, val)
        return {"success": True, "modified_clip": clip.model_dump()}

    elif op == "split_clip":
        track = _find_track(timeline, params["track_id"])
        if not track:
            return {"error": f"Track not found: {params['track_id']}"}
        clip = _find_clip(track, params["clip_id"])
        if not clip:
            return {"error": f"Clip not found: {params['clip_id']}"}

        split_at = params["split_at_sec"]  # timeline time
        if split_at <= clip.timeline_start_sec or split_at >= clip.timeline_start_sec + clip.duration_sec:
            return {"error": f"Split point {split_at}s is outside clip range"}

        # Calculate split
        offset_in_clip = split_at - clip.timeline_start_sec
        speed = clip.speed or 1.0
        source_split = (clip.source_in_sec or 0) + offset_in_clip * speed

        # First half
        clip1 = deepcopy(clip)
        clip1.id = _gen_id("clip")
        clip1.duration_sec = offset_in_clip
        clip1.source_out_sec = source_split

        # Second half
        clip2 = deepcopy(clip)
        clip2.id = _gen_id("clip")
        clip2.timeline_start_sec = split_at
        clip2.duration_sec = clip.duration_sec - offset_in_clip
        clip2.source_in_sec = source_split

        # Replace original with two halves
        idx = track.clips.index(clip)
        track.clips[idx:idx + 1] = [clip1, clip2]

        return {
            "success": True,
            "clip_1": clip1.model_dump(),
            "clip_2": clip2.model_dump(),
        }

    else:
        return {"error": f"Unknown operation: {op}"}


def _find_track(timeline: TimelineProject, track_id: str) -> Track | None:
    for track in timeline.tracks:
        if track.id == track_id:
            return track
    return None


def _find_clip(track: Track, clip_id: str) -> Clip | None:
    for clip in track.clips:
        if clip.id == clip_id:
            return clip
    return None
