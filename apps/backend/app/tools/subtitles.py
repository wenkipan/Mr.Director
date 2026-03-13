"""Subtitle generation tool: generate subtitles from ASR transcript."""

from __future__ import annotations

import uuid

from app.models.timeline import Clip, Track
from app.tools.registry import registry


@registry.register(
    name="generate_subtitles",
    description=(
        "Generate a subtitle track from transcript segments (ASR output). "
        "Creates subtitle clips at the correct timestamps. Creates the track if it doesn't exist. "
        "\n\nWhen to use: after transcribe_audio, to place subtitles on the timeline in bulk. "
        "When NOT to use: editing individual subtitle text/style (use update_clips), "
        "applying a style preset (use apply_subtitle_style)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "segments": {
                "type": "STRING",
                "description": "JSON array of transcript segments: [{start, end, text}]",
            },
            "track_id": {
                "type": "STRING",
                "description": "ID for the subtitle track. Will be created if it doesn't exist.",
            },
            "track_name": {
                "type": "STRING",
                "description": "Name for the subtitle track, default 'Subtitles'",
            },
        },
        "required": ["segments"],
    },
)
async def generate_subtitles(args: dict, state) -> dict:
    import json

    if not state.current_timeline:
        return {"error": "No timeline exists. Use create_timeline first."}

    try:
        segments = json.loads(args["segments"]) if isinstance(args["segments"], str) else args["segments"]
    except json.JSONDecodeError as e:
        return {"error": f"Invalid segments JSON: {e}"}

    track_id = args.get("track_id", f"sub_{uuid.uuid4().hex[:8]}")
    track_name = args.get("track_name", "Subtitles")

    # Find or create subtitle track
    sub_track = None
    for t in state.current_timeline.tracks:
        if t.id == track_id:
            sub_track = t
            break

    if not sub_track:
        sub_track = Track(id=track_id, name=track_name, type="subtitle", clips=[])
        state.current_timeline.tracks.append(sub_track)

    # Create subtitle clips from segments
    clips_added = 0
    for seg in segments:
        start = float(seg["start"])
        end = float(seg["end"])
        text = seg.get("text", "").strip()
        if not text:
            continue

        clip = Clip(
            id=f"sub_{uuid.uuid4().hex[:8]}",
            type="subtitle",
            timeline_start_sec=start,
            timeline_end_sec=end,
            subtitle_text=text,
            subtitle_style_ref="default",
        )
        sub_track.clips.append(clip)
        clips_added += 1

    sub_track.clips.sort(key=lambda c: c.timeline_start_sec)

    return {
        "success": True,
        "track_id": track_id,
        "clips_added": clips_added,
    }
