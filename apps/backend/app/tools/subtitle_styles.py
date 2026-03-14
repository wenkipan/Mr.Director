"""Agent tool for managing subtitle style presets."""

from __future__ import annotations

import json

from app.models.timeline import SubtitleStyle
from app.services.subtitle_styles import (
    delete_preset,
    ensure_default_preset,
    list_presets,
    load_preset,
    save_preset,
)
from app.tools.registry import registry


@registry.register(
    name="manage_subtitle_styles",
    description=(
        "Manage subtitle style presets (shared across all projects). "
        "Presets define reusable subtitle appearance (font, color, position, etc). "
        "Operations: list, get, create, update, delete. "
        "\n\nWhen to use: user wants to create/modify a reusable subtitle look (e.g. 'cinematic', 'bold-yellow'). "
        "When NOT to use: changing style on a single clip (use update_clips with subtitle_style), "
        "applying an existing preset to clips (use apply_subtitle_style)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "operation": {
                "type": "STRING",
                "description": "One of: list, get, create, update, delete",
            },
            "name": {
                "type": "STRING",
                "description": "Preset name (e.g. 'default', 'cinematic'). Required for get/create/update/delete.",
            },
            "style": {
                "type": "STRING",
                "description": (
                    "JSON object with style properties for create/update. "
                    "Available properties: position_x, position_y, font_family, font_size, "
                    "color, background, text_align, bold, italic, outline_color, outline_width, "
                    "shadow, padding, border_radius, opacity, letter_spacing. "
                    "Supported font_family values: sans-serif, serif, monospace (generic), "
                    "arial, times-new-roman, courier-new, georgia, impact (system), "
                    "noto-sans, noto-serif, noto-sans-sc, noto-sans-tc, noto-sans-jp (Noto/CJK), "
                    "roboto, inter, open-sans, montserrat, poppins, lato (Google sans-serif), "
                    "merriweather, playfair-display (Google serif), "
                    "oswald, bebas-neue (Google display)."
                ),
            },
        },
        "required": ["operation"],
    },
)
async def manage_subtitle_styles(args: dict, state) -> dict:
    ensure_default_preset()

    operation = args.get("operation", "").lower()

    if operation == "list":
        names = list_presets()
        presets = {}
        for n in names:
            presets[n] = load_preset(n).model_dump(exclude_none=True)
        return {"presets": presets}

    if operation == "get":
        name = args.get("name")
        if not name:
            return {"error": "name is required for get operation"}
        preset = load_preset(name)
        return {"name": name, "style": preset.model_dump(exclude_none=True)}

    if operation == "create":
        name = args.get("name")
        if not name:
            return {"error": "name is required for create operation"}
        style_str = args.get("style", "{}")
        try:
            style_data = json.loads(style_str) if isinstance(style_str, str) else style_str
        except json.JSONDecodeError as e:
            return {"error": f"Invalid style JSON: {e}"}
        style = SubtitleStyle(**style_data)
        save_preset(name, style)
        return {"created": name, "style": load_preset(name).model_dump(exclude_none=True)}

    if operation == "update":
        name = args.get("name")
        if not name:
            return {"error": "name is required for update operation"}
        style_str = args.get("style", "{}")
        try:
            style_data = json.loads(style_str) if isinstance(style_str, str) else style_str
        except json.JSONDecodeError as e:
            return {"error": f"Invalid style JSON: {e}"}
        # Merge with existing preset
        current = load_preset(name)
        merged = current.model_dump()
        for key, value in style_data.items():
            if key in merged:
                merged[key] = value
        save_preset(name, SubtitleStyle(**merged))
        return {"updated": name, "style": load_preset(name).model_dump(exclude_none=True)}

    if operation == "delete":
        name = args.get("name")
        if not name:
            return {"error": "name is required for delete operation"}
        if delete_preset(name):
            return {"deleted": name}
        return {"error": f"Cannot delete preset '{name}' (protected or not found)"}

    return {"error": f"Unknown operation: {operation}. Use list/get/create/update/delete."}


@registry.register(
    name="apply_subtitle_style",
    description=(
        "Apply a subtitle style preset to one or more subtitle clips by setting their subtitle_style_ref. "
        "Use '*' for clip_ids to apply to ALL subtitle clips. "
        "\n\nWhen to use: changing the look of subtitles in bulk after creating/modifying a preset. "
        "When NOT to use: creating or editing the preset itself (use manage_subtitle_styles)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "preset_name": {
                "type": "STRING",
                "description": "Name of the preset to apply (e.g. 'default', 'cinematic')",
            },
            "clip_ids": {
                "type": "STRING",
                "description": "JSON array of clip IDs to apply the preset to. Use '*' to apply to all subtitle clips.",
            },
        },
        "required": ["preset_name", "clip_ids"],
    },
)
async def apply_subtitle_style(args: dict, state) -> dict:
    if not state.current_timeline:
        return {"error": "No timeline exists."}

    preset_name = args.get("preset_name", "default")
    clip_ids_raw = args.get("clip_ids", "[]")

    # Verify preset exists
    ensure_default_preset()
    preset = load_preset(preset_name)
    if preset is None:
        return {"error": f"Preset '{preset_name}' not found"}

    # Parse clip IDs
    try:
        clip_ids = json.loads(clip_ids_raw) if isinstance(clip_ids_raw, str) else clip_ids_raw
    except json.JSONDecodeError:
        clip_ids = [clip_ids_raw]

    apply_all = clip_ids == "*" or clip_ids == ["*"]

    updated = 0
    for track in state.current_timeline.tracks:
        if track.type != "subtitle":
            continue
        for clip in track.clips:
            if apply_all or clip.id in clip_ids:
                clip.subtitle_style_ref = preset_name
                updated += 1

    return {"updated": updated, "preset": preset_name}
