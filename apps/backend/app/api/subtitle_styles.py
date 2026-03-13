"""REST API for managing subtitle style presets (shared across all projects)."""

from fastapi import APIRouter, HTTPException

from app.models.timeline import SubtitleStyle
from app.services.subtitle_styles import (
    _styles_dir,
    delete_preset,
    ensure_default_preset,
    list_presets,
    load_preset,
    save_preset,
)

router = APIRouter()


@router.get("")
async def get_presets():
    """List all style presets."""
    ensure_default_preset()
    names = list_presets()
    presets = {}
    for name in names:
        presets[name] = load_preset(name).model_dump(exclude_none=True)
    return {"presets": presets}


@router.get("/{name}")
async def get_preset(name: str):
    """Get a single style preset."""
    preset = load_preset(name)
    return {"name": name, "style": preset.model_dump(exclude_none=True)}


@router.put("/{name}")
async def upsert_preset(name: str, style: SubtitleStyle):
    """Create or update a style preset."""
    path = _styles_dir() / f"{name}.json"
    if path.exists():
        current = load_preset(name)
        merged = current.model_dump()
        for key, value in style.model_dump(exclude_none=True).items():
            merged[key] = value
        save_preset(name, SubtitleStyle(**merged))
    else:
        save_preset(name, style)
    return {"name": name, "style": load_preset(name).model_dump(exclude_none=True)}


@router.delete("/{name}")
async def remove_preset(name: str):
    """Delete a style preset. Cannot delete 'default'."""
    if not delete_preset(name):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete preset '{name}' (protected or not found)",
        )
    return {"deleted": name}
