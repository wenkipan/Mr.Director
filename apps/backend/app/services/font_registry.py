"""Font registry – mirrors packages/shared/src/fonts.ts for Python.

Provides the curated list of supported fonts and resolution helpers for
ASS export (fontconfig / libass font names).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True, slots=True)
class FontDefinition:
    id: str
    display_name: str
    category: Literal["sans-serif", "serif", "monospace", "display", "cjk"]
    source: Literal["generic", "system", "google"]
    fontconfig_name: str


SUPPORTED_FONTS: list[FontDefinition] = [
    # ── CSS Generic Families ─────────────────────────────────
    FontDefinition("sans-serif", "Sans Serif", "sans-serif", "generic", "Arial"),
    FontDefinition("serif", "Serif", "serif", "generic", "Times New Roman"),
    FontDefinition("monospace", "Monospace", "monospace", "generic", "Courier New"),

    # ── System Fonts (msttcorefonts) ─────────────────────────
    FontDefinition("arial", "Arial", "sans-serif", "system", "Arial"),
    FontDefinition("times-new-roman", "Times New Roman", "serif", "system", "Times New Roman"),
    FontDefinition("courier-new", "Courier New", "monospace", "system", "Courier New"),
    FontDefinition("georgia", "Georgia", "serif", "system", "Georgia"),
    FontDefinition("impact", "Impact", "display", "system", "Impact"),

    # ── System Fonts (Noto) ──────────────────────────────────
    FontDefinition("noto-sans", "Noto Sans", "sans-serif", "system", "Noto Sans"),
    FontDefinition("noto-serif", "Noto Serif", "serif", "system", "Noto Serif"),

    # ── System Fonts (CJK) ──────────────────────────────────
    FontDefinition("noto-sans-sc", "Noto Sans SC", "cjk", "system", "Noto Sans CJK SC"),
    FontDefinition("noto-sans-tc", "Noto Sans TC", "cjk", "system", "Noto Sans CJK TC"),
    FontDefinition("noto-sans-jp", "Noto Sans JP", "cjk", "system", "Noto Sans CJK JP"),

    # ── Google Fonts ─────────────────────────────────────────
    FontDefinition("roboto", "Roboto", "sans-serif", "google", "Roboto"),
    FontDefinition("inter", "Inter", "sans-serif", "google", "Inter"),
    FontDefinition("open-sans", "Open Sans", "sans-serif", "google", "Open Sans"),
    FontDefinition("montserrat", "Montserrat", "sans-serif", "google", "Montserrat"),
    FontDefinition("poppins", "Poppins", "sans-serif", "google", "Poppins"),
    FontDefinition("lato", "Lato", "sans-serif", "google", "Lato"),
    FontDefinition("merriweather", "Merriweather", "serif", "google", "Merriweather"),
    FontDefinition("playfair-display", "Playfair Display", "serif", "google", "Playfair Display"),
    FontDefinition("oswald", "Oswald", "display", "google", "Oswald"),
    FontDefinition("bebas-neue", "Bebas Neue", "display", "google", "Bebas Neue"),
]

FONT_BY_ID: dict[str, FontDefinition] = {f.id: f for f in SUPPORTED_FONTS}

# Legacy CSS generic → concrete name mapping (kept for backward compat with
# values that may already be stored in timeline JSON).
_CSS_GENERIC_MAP: dict[str, str] = {
    "sans-serif": "Arial",
    "serif": "Times New Roman",
    "monospace": "Courier New",
    "cursive": "Comic Sans MS",
    "fantasy": "Impact",
}


def resolve_fontconfig_name(font_family: str) -> str:
    """Resolve a font_family value to a fontconfig-compatible name for libass.

    Handles:
    - Font IDs from the registry (e.g. "roboto" → "Roboto")
    - CSS generic families (e.g. "sans-serif" → "Arial")
    - Raw font names pass through unchanged (e.g. "Arial" → "Arial")
    """
    stripped = font_family.strip().strip("'\"")

    # 1) Lookup by font ID (case-insensitive)
    font = FONT_BY_ID.get(stripped.lower())
    if font:
        return font.fontconfig_name

    # 2) CSS generic family mapping
    generic = _CSS_GENERIC_MAP.get(stripped.lower())
    if generic:
        return generic

    # 3) Pass through (concrete font name)
    return stripped


def get_fonts_dir() -> str:
    """Return the path to the bundled Google Font TTF directory."""
    return str(Path(__file__).resolve().parent.parent.parent / "fonts")
