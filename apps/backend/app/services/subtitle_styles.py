"""Subtitle style preset management.

Presets are stored as JSON files under projects/styles/ (shared across all projects).
Each file (e.g. default.json) contains a full SubtitleStyle object.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.config import settings
from app.models.timeline import (
    DEFAULT_SUBTITLE_STYLE,
    SubtitleStyle,
    resolve_subtitle_style,
)

logger = logging.getLogger(__name__)


def _styles_dir() -> Path:
    d = Path(settings.projects_dir) / "styles"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_default_preset() -> None:
    """Create default.json if it doesn't exist."""
    path = _styles_dir() / "default.json"
    if not path.exists():
        save_preset("default", DEFAULT_SUBTITLE_STYLE)


def list_presets() -> list[str]:
    """Return sorted list of preset names (without .json extension)."""
    d = _styles_dir()
    return sorted(p.stem for p in d.glob("*.json"))


def load_preset(name: str) -> SubtitleStyle:
    """Load a preset by name. Falls back to DEFAULT_SUBTITLE_STYLE if not found."""
    path = _styles_dir() / f"{name}.json"
    if not path.exists():
        logger.warning(f"Preset '{name}' not found, using defaults")
        return DEFAULT_SUBTITLE_STYLE.model_copy()
    try:
        data = json.loads(path.read_text())
        return SubtitleStyle(**data)
    except Exception as e:
        logger.warning(f"Failed to load preset '{name}': {e}, using defaults")
        return DEFAULT_SUBTITLE_STYLE.model_copy()


def save_preset(name: str, style: SubtitleStyle) -> None:
    """Save a preset to disk."""
    path = _styles_dir() / f"{name}.json"
    path.write_text(json.dumps(style.model_dump(exclude_none=True), indent=2))


def delete_preset(name: str) -> bool:
    """Delete a preset. Returns False if it's 'default' or doesn't exist."""
    if name == "default":
        return False
    path = _styles_dir() / f"{name}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def resolve_clip_style(
    style_ref: str | None, override: SubtitleStyle | None = None
) -> SubtitleStyle:
    """Resolve final style for a clip: load preset, apply overrides."""
    preset = load_preset(style_ref or "default")
    return resolve_subtitle_style(preset, override)
