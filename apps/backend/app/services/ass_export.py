"""ASS subtitle generation from TimelineProject."""

from __future__ import annotations

import hashlib
import logging
import math
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import ImageFont

from app.models.timeline import TimelineProject, SubtitleStyle
from app.services.subtitle_styles import resolve_clip_style, ensure_default_preset

logger = logging.getLogger(__name__)


@dataclass
class _SrtEntry:
    start_sec: float
    end_sec: float
    text: str


def _parse_srt(content: str) -> list[_SrtEntry]:
    """Parse SRT subtitle content into entries."""
    entries: list[_SrtEntry] = []
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        ts_line = None
        text_start = 0
        for i, line in enumerate(lines):
            if "-->" in line:
                ts_line = line
                text_start = i + 1
                break
        if not ts_line:
            continue
        m = re.match(
            r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*"
            r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})",
            ts_line.strip(),
        )
        if not m:
            continue
        start = (
            int(m.group(1)) * 3600
            + int(m.group(2)) * 60
            + int(m.group(3))
            + int(m.group(4)) / 1000
        )
        end = (
            int(m.group(5)) * 3600
            + int(m.group(6)) * 60
            + int(m.group(7))
            + int(m.group(8)) / 1000
        )
        text = "\n".join(lines[text_start:]).strip()
        if text:
            entries.append(_SrtEntry(start_sec=start, end_sec=end, text=text))
    return entries


def _sec_to_ass_time(sec: float) -> str:
    """Convert seconds to ASS time format H:MM:SS.cc (centiseconds)."""
    total_cs = max(0, int(round(sec * 100)))
    h = total_cs // 360000
    total_cs %= 360000
    m = total_cs // 6000
    total_cs %= 6000
    s = total_cs // 100
    cs = total_cs % 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _parse_css_color(css: str) -> tuple[int, int, int, float]:
    """Parse CSS color to (r, g, b, alpha).  alpha: 0.0=transparent, 1.0=opaque."""
    css = css.strip()
    if css == "transparent":
        return (0, 0, 0, 0.0)

    # rgba(r,g,b,a) or rgb(r,g,b)
    m = re.match(
        r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)",
        css,
    )
    if m:
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        a = float(m.group(4)) if m.group(4) else 1.0
        return (r, g, b, a)

    # #RRGGBB or #RRGGBBAA
    m2 = re.match(r"#([0-9a-fA-F]{6,8})", css)
    if m2:
        h = m2.group(1)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255.0 if len(h) == 8 else 1.0
        return (r, g, b, a)

    return (255, 255, 255, 1.0)


def _css_to_ass_color(css: str) -> str:
    """Convert CSS color to ASS ``&HAABBGGRR&``.

    ASS alpha: ``00`` = opaque, ``FF`` = transparent (inverted from CSS).
    """
    r, g, b, a = _parse_css_color(css)
    ass_alpha = int((1.0 - a) * 255)
    return f"&H{ass_alpha:02X}{b:02X}{g:02X}{r:02X}&"


def _strip_srt_tags(text: str) -> str:
    """Strip HTML-like inline tags common in SRT files (e.g. <b>, <i>, <font>)."""
    return re.sub(r"<[^>]+>", "", text)


# Matches ASS override tag blocks like {\b1}, {\s1\i1}, etc.
_ASS_OVERRIDE_RE = re.compile(r'\{\\[^}]+\}')


def _escape_ass_text(text: str) -> str:
    """Escape special characters for ASS dialogue text.

    Preserves ASS override tag blocks (e.g. {\\s1}, {\\b1\\i1}) while
    escaping stray curly braces and backslashes in plain text segments.
    """
    parts: list[str] = []
    last = 0
    for m in _ASS_OVERRIDE_RE.finditer(text):
        # Escape the plain-text segment before this tag block
        plain = text[last:m.start()]
        parts.append(
            plain.replace("\\", "\\\\")
            .replace("{", "\\{")
            .replace("}", "\\}")
            .replace("\n", "\\N")
        )
        # Keep the override tag block as-is
        parts.append(m.group())
        last = m.end()
    # Escape the remaining plain-text tail
    tail = text[last:]
    parts.append(
        tail.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", "\\N")
    )
    return "".join(parts)


from app.services.font_registry import resolve_font_path as _resolve_font_path
from app.services.font_registry import resolve_fontconfig_name as _resolve_font_family


def _parse_css_padding(padding_str: str | None) -> float:
    """Parse CSS padding string and return a single representative value for ASS.

    ASS Outline only supports a single uniform value, so we take the max of
    all padding components (e.g. '4px 16px' → 16.0).
    """
    if not padding_str:
        return 0.0
    parts = padding_str.replace("px", "").split()
    try:
        values = [float(v) for v in parts]
    except ValueError:
        return 0.0
    return max(values) if values else 0.0


def _parse_css_padding_components(padding_str: str | None) -> tuple[float, float]:
    """Parse CSS padding to *(vertical, horizontal)* pixel values.

    Handles 1–4 value CSS shorthand.
    """
    if not padding_str:
        return (0.0, 0.0)
    parts = padding_str.replace("px", "").split()
    try:
        values = [float(v) for v in parts]
    except ValueError:
        return (0.0, 0.0)
    if len(values) == 1:
        return (values[0], values[0])
    if len(values) == 2:
        return (values[0], values[1])
    if len(values) == 3:
        return (values[0], values[1])
    if len(values) >= 4:
        return (max(values[0], values[2]), max(values[1], values[3]))
    return (0.0, 0.0)


def _load_pil_font(font_family: str, font_size: float, bold: bool) -> ImageFont.FreeTypeFont | None:
    """Load a PIL ImageFont for the given family and size. Returns None on failure."""
    path = _resolve_font_path(font_family, bold=bold)
    if not path:
        return None
    try:
        return ImageFont.truetype(path, size=int(round(font_size)))
    except Exception:
        logger.debug("Failed to load font %s at size %s", path, font_size)
        return None


# Module-level cache: (font_path, font_size) → ImageFont instance
_pil_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _get_pil_font(font_family: str, font_size: float, bold: bool) -> ImageFont.FreeTypeFont | None:
    """Get a cached PIL ImageFont instance."""
    path = _resolve_font_path(font_family, bold=bold)
    if not path:
        return None
    key = (path, int(round(font_size)))
    cached = _pil_font_cache.get(key)
    if cached is not None:
        return cached
    font = _load_pil_font(font_family, font_size, bold)
    if font is not None:
        _pil_font_cache[key] = font
    return font


def _estimate_text_block_size(
    text: str, font_size: float, pad_v: float, pad_h: float, max_width: float,
    pil_font: ImageFont.FreeTypeFont | None = None,
) -> tuple[float, float]:
    """Estimate rendered bounding box *(width, height)* for a text block.

    When *pil_font* is provided, uses FreeType metrics for precise measurement.
    Falls back to character-width heuristics when no font is available.
    """
    lines = text.split("\n")
    max_content_w = max_width - 2 * pad_h

    if pil_font is not None:
        return _measure_with_pil(lines, pil_font, pad_v, pad_h, max_content_w)
    return _measure_heuristic(lines, font_size, pad_v, pad_h, max_content_w)


def _measure_with_pil(
    lines: list[str],
    font: ImageFont.FreeTypeFont,
    pad_v: float,
    pad_h: float,
    max_content_w: float,
) -> tuple[float, float]:
    """Measure text block using Pillow FreeType metrics."""
    ascent, descent = font.getmetrics()
    line_height = ascent + descent

    max_line_w = 0.0
    total_lines = 0
    for line in lines:
        if not line:  # skip empty lines (e.g. trailing \N)
            continue
        w = font.getlength(line)
        if max_content_w > 0 and w > max_content_w:
            total_lines += math.ceil(w / max_content_w)
            max_line_w = max(max_line_w, max_content_w)
        else:
            total_lines += 1
            max_line_w = max(max_line_w, w)
    total_lines = max(total_lines, 1)  # at least 1 line

    width = max_line_w + 2 * pad_h
    height = total_lines * line_height + 2 * pad_v
    return (width, height)


def _measure_heuristic(
    lines: list[str],
    font_size: float,
    pad_v: float,
    pad_h: float,
    max_content_w: float,
) -> tuple[float, float]:
    """Fallback: estimate text block using character-width heuristics."""
    line_height = font_size * 1.2

    max_line_w = 0.0
    total_lines = 0
    for line in lines:
        if not line:  # skip empty lines (e.g. trailing \N)
            continue
        w = 0.0
        for ch in line:
            cp = ord(ch)
            if (
                0x2E80 <= cp <= 0x9FFF
                or 0xF900 <= cp <= 0xFAFF
                or 0xFE30 <= cp <= 0xFE4F
                or 0x20000 <= cp <= 0x2FA1F
                or 0x3000 <= cp <= 0x303F
                or 0x3040 <= cp <= 0x30FF
                or 0xFF00 <= cp <= 0xFFEF
            ):
                w += font_size
            elif ch == " ":
                w += font_size * 0.3
            else:
                w += font_size * 0.55
        if max_content_w > 0 and w > max_content_w:
            total_lines += math.ceil(w / max_content_w)
            max_line_w = max(max_line_w, max_content_w)
        else:
            total_lines += 1
            max_line_w = max(max_line_w, w)
    total_lines = max(total_lines, 1)  # at least 1 line

    width = max_line_w + 2 * pad_h
    height = total_lines * line_height + 2 * pad_v
    return (width, height)


def _draw_rounded_rect(w: float, h: float, r: float = 0) -> str:
    """Generate ASS ``\\p1`` drawing commands for a (rounded) rectangle.

    Coordinates span ``(0, 0)`` → ``(w, h)``.  With alignment 5 the
    rectangle centre is placed at the ``\\pos`` coordinate.
    """
    wi, hi = int(round(w)), int(round(h))
    if r < 1:
        return f"m 0 0 l {wi} 0 {wi} {hi} 0 {hi}"
    ri = int(min(round(r), wi // 2, hi // 2))
    if ri < 1:
        return f"m 0 0 l {wi} 0 {wi} {hi} 0 {hi}"
    c = int(round(ri * 0.5523))
    return (
        f"m {ri} 0 "
        f"l {wi - ri} 0 "
        f"b {wi - ri + c} 0 {wi} {ri - c} {wi} {ri} "
        f"l {wi} {hi - ri} "
        f"b {wi} {hi - ri + c} {wi - ri + c} {hi} {wi - ri} {hi} "
        f"l {ri} {hi} "
        f"b {ri - c} {hi} 0 {hi - ri + c} 0 {hi - ri} "
        f"l 0 {ri} "
        f"b 0 {ri - c} {ri - c} 0 {ri} 0"
    )


def _apply_opacity_to_ass_color(ass_color: str, opacity: float) -> str:
    """Apply a global opacity multiplier to an ASS ``&HAABBGGRR&`` color.

    Combines the existing alpha with the opacity:
    ``new_alpha = 1 - (1 - existing_alpha/255) * opacity``
    """
    if opacity >= 1.0:
        return ass_color
    m = re.match(r"&H([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})&", ass_color)
    if not m:
        return ass_color
    existing_ass_alpha = int(m.group(1), 16)  # 00=opaque, FF=transparent
    rest = m.group(2)
    css_alpha = 1.0 - existing_ass_alpha / 255.0
    combined = css_alpha * opacity
    new_ass_alpha = int((1.0 - combined) * 255)
    new_ass_alpha = max(0, min(255, new_ass_alpha))
    return f"&H{new_ass_alpha:02X}{rest}&"


def _parse_css_text_shadow(shadow: str | None) -> tuple[float, str | None]:
    """Parse CSS text-shadow to extract shadow distance and color for ASS.

    Returns ``(distance, color_css_or_none)``.
    """
    if not shadow or shadow == "none":
        return (0.0, None)
    parts = shadow.strip().split()
    nums: list[float] = []
    color_parts: list[str] = []
    for part in parts:
        cleaned = part.rstrip(",").replace("px", "")
        try:
            nums.append(float(cleaned))
        except ValueError:
            color_parts.append(part)
    if len(nums) >= 2:
        dist = max(abs(nums[0]), abs(nums[1]))
        color = " ".join(color_parts) if color_parts else None
        return (dist, color)
    return (0.0, None)


def _build_alpha_override_tags(s: SubtitleStyle) -> str:
    """Build ASS override tags for color alpha channels.

    libass with ``BorderStyle=3`` often ignores the alpha byte embedded in
    ``BackColour`` of the style definition.  Explicitly setting ``\\4a``
    (back alpha) in each dialogue line ensures transparency is applied
    regardless of renderer quirks.
    """
    tags = ""
    global_opacity = s.opacity if s.opacity is not None else 1.0

    # \\3a — Outline alpha (controls background box transparent when BorderStyle=3)
    bg = s.background or "rgba(0,0,0,0.6)"
    has_bg = bg and bg != "transparent"
    if has_bg:
        _, _, _, bg_alpha = _parse_css_color(bg)
        combined_bg = bg_alpha * global_opacity
        if combined_bg < 1.0:
            ass_a = int((1.0 - combined_bg) * 255)
            tags += f"\\3a&H{ass_a:02X}&\\4a&H{ass_a:02X}&"

    # \\1a — PrimaryColour alpha (text transparency, only when opacity < 1)
    if global_opacity < 1.0:
        text_color = s.color or "#FFFFFF"
        _, _, _, text_alpha = _parse_css_color(text_color)
        combined_text = text_alpha * global_opacity
        ass_a = int((1.0 - combined_text) * 255)
        tags += f"\\1a&H{ass_a:02X}&"

    return tags


def _style_hash(s: SubtitleStyle) -> str:
    key = s.model_dump_json(exclude_none=True)
    return hashlib.md5(key.encode()).hexdigest()[:8]


def _build_style_line(name: str, s: SubtitleStyle, play_res_x: int, *, mode: str = "auto") -> str:
    """Build one ASS ``[V4+ Styles]`` line.

    *mode*:
      ``"auto"``  – default: BorderStyle=3 box when background is set.
      ``"bg"``    – background drawing layer (PrimaryColour=bg, no border).
      ``"text"``  – text-only layer (no background box, keep outline/shadow).
    """
    # ── Common ────────────────────────────────────────────────
    font = _resolve_font_family(s.font_family or "sans-serif")
    # ASS Fontsize spans the full ascender-to-descender bounding box, while
    # CSS font-size represents the Em-square.  A ×4/3 factor matches the
    # visual size produced by libass against a browser rendering.
    base_font_size = s.font_size or 48
    ass_font_size = int(round(base_font_size * 1.3333))
    global_opacity = s.opacity if s.opacity is not None else 1.0
    alignment = 5
    margin_h = int(play_res_x * 0.10)

    # ── bg mode: style for \p1 background drawing ─────────────
    if mode == "bg":
        bg = s.background or "rgba(0,0,0,0.6)"
        primary = _css_to_ass_color(bg)
        if global_opacity < 1.0:
            primary = _apply_opacity_to_ass_color(primary, global_opacity)
        return (
            f"Style: {name},{font},{ass_font_size},"
            f"{primary},&HFF000000&,&HFF000000&,&HFF000000&,"
            f"0,0,0,0,100,100,0,0,"
            f"1,0,0,{alignment},{margin_h},{margin_h},0,1"
        )

    # ── text mode: text without background box ────────────────
    if mode == "text":
        primary = _css_to_ass_color(s.color or "#FFFFFF")
        secondary = "&H00000000&"
        has_outline = (s.outline_width or 0) > 0 and s.outline_color and s.outline_color != "transparent"
        outline_color = _css_to_ass_color(s.outline_color or "#000000") if has_outline else "&H00000000&"
        shadow_dist, shadow_color_css = _parse_css_text_shadow(s.shadow)
        back = _css_to_ass_color(shadow_color_css) if shadow_color_css else "&H00000000&"
        if global_opacity < 1.0:
            primary = _apply_opacity_to_ass_color(primary, global_opacity)
            secondary = _apply_opacity_to_ass_color(secondary, global_opacity)
            outline_color = _apply_opacity_to_ass_color(outline_color, global_opacity)
            back = _apply_opacity_to_ass_color(back, global_opacity)
        bold = -1 if s.bold else 0
        italic = -1 if s.italic else 0
        spacing = s.letter_spacing or 0
        outline_val = s.outline_width or 0
        return (
            f"Style: {name},{font},{ass_font_size},"
            f"{primary},{secondary},{outline_color},{back},"
            f"{bold},{italic},0,0,100,100,{spacing},0,"
            f"1,{outline_val},{shadow_dist},{alignment},{margin_h},{margin_h},0,1"
        )

    # ── auto mode (original behavior) ────────────────────────
    primary = _css_to_ass_color(s.color or "#FFFFFF")
    secondary = "&H00000000&"

    bg = s.background or "rgba(0,0,0,0.6)"
    has_outline = (s.outline_width or 0) > 0 and s.outline_color and s.outline_color != "transparent"
    has_bg = bg and bg != "transparent"

    shadow_dist, shadow_color_css = _parse_css_text_shadow(s.shadow)

    border_style = 3 if has_bg else 1

    if border_style == 3:
        outline_color = _css_to_ass_color(bg)
        if shadow_color_css:
            back = _css_to_ass_color(shadow_color_css)
        else:
            back = "&H00000000&"
    else:
        outline_color = _css_to_ass_color(s.outline_color or "#000000") if has_outline else "&H00000000&"
        if shadow_color_css:
            back = _css_to_ass_color(shadow_color_css)
        else:
            back = "&H00000000&"

    if global_opacity < 1.0:
        primary = _apply_opacity_to_ass_color(primary, global_opacity)
        secondary = _apply_opacity_to_ass_color(secondary, global_opacity)
        outline_color = _apply_opacity_to_ass_color(outline_color, global_opacity)
        back = _apply_opacity_to_ass_color(back, global_opacity)

    bold = -1 if s.bold else 0
    italic = -1 if s.italic else 0
    spacing = s.letter_spacing or 0

    if border_style == 3:
        padding_px = _parse_css_padding(s.padding)
        outline_val = max(padding_px, s.outline_width or 0)
    else:
        outline_val = s.outline_width or 0

    return (
        f"Style: {name},{font},{ass_font_size},"
        f"{primary},{secondary},{outline_color},{back},"
        f"{bold},{italic},0,0,100,100,{spacing},0,"
        f"{border_style},{outline_val},{shadow_dist},{alignment},{margin_h},{margin_h},0,1"
    )


# ── public API ──────────────────────────────────────────────


def _build_dialogues(
    text: str,
    start_sec: float,
    end_sec: float,
    style: SubtitleStyle,
    style_hash: str,
    has_bg: bool,
    pos_x: int,
    pos_y: int,
    play_res_x: int,
    pil_font: ImageFont.FreeTypeFont | None = None,
) -> list[str]:
    """Build ASS dialogue entries for one subtitle event.

    Returns two entries (background drawing + text) when *has_bg*,
    one entry otherwise.
    """
    start = _sec_to_ass_time(start_sec)
    end = _sec_to_ass_time(end_sec)

    # Strip trailing newlines — they create invisible empty lines that inflate
    # both the \p1 background box and the ASS text rendering.
    text = text.rstrip("\n")

    if not has_bg:
        alpha_tags = _build_alpha_override_tags(style)
        tags = f"{{\\pos({pos_x},{pos_y}){alpha_tags}}}"
        return [
            f"Dialogue: 0,{start},{end},S_{style_hash},,0,0,0,,"
            f"{tags}{_escape_ass_text(text)}"
        ]

    entries: list[str] = []
    global_opacity = style.opacity if style.opacity is not None else 1.0

    # ── Background drawing (layer 0) ─────────────────────────
    # Use the ×4/3 scaled size to match the ASS text layer rendering size.
    font_size = int(round((style.font_size or 48) * 1.3333))
    pad_v, pad_h = _parse_css_padding_components(style.padding)
    max_w = play_res_x * 0.8
    # Strip ASS override tags (e.g. {\s1}, {\b1\i1}) before measuring —
    # they are invisible but inflate PIL/heuristic width calculations.
    measure_text = _ASS_OVERRIDE_RE.sub("", text)
    box_w, box_h = _estimate_text_block_size(measure_text, font_size, pad_v, pad_h, max_w, pil_font)
    border_r = style.border_radius or 0
    drawing = _draw_rounded_rect(box_w, box_h, border_r)

    bg_color = style.background or "rgba(0,0,0,0.6)"
    _, _, _, bg_a = _parse_css_color(bg_color)
    combined_bg = bg_a * global_opacity
    bg_alpha_tag = ""
    if combined_bg < 1.0:
        ass_a = int((1.0 - combined_bg) * 255)
        bg_alpha_tag = f"\\1a&H{ass_a:02X}&"

    bg_tags = f"{{\\pos({pos_x},{pos_y})\\p1{bg_alpha_tag}}}"
    entries.append(
        f"Dialogue: 0,{start},{end},S_{style_hash}_BG,,0,0,0,,"
        f"{bg_tags}{drawing}"
    )

    # ── Text (layer 1) ───────────────────────────────────────
    tx_alpha = ""
    if global_opacity < 1.0:
        tc = style.color or "#FFFFFF"
        _, _, _, ta = _parse_css_color(tc)
        ass_a = int((1.0 - ta * global_opacity) * 255)
        tx_alpha += f"\\1a&H{ass_a:02X}&"
        if (style.outline_width or 0) > 0:
            oc = style.outline_color or "#000000"
            _, _, _, oa = _parse_css_color(oc)
            ass_oa = int((1.0 - oa * global_opacity) * 255)
            tx_alpha += f"\\3a&H{ass_oa:02X}&"

    tx_tags = f"{{\\pos({pos_x},{pos_y}){tx_alpha}}}"
    entries.append(
        f"Dialogue: 1,{start},{end},S_{style_hash}_TX,,0,0,0,,"
        f"{tx_tags}{_escape_ass_text(text)}"
    )

    return entries


def generate_ass(
    timeline: TimelineProject, output_path: str
) -> str | None:
    """Generate an ASS subtitle file from timeline subtitle tracks.

    Resolves subtitle style presets before generating.
    Returns *output_path* on success, ``None`` if no subtitles found.
    """
    W = timeline.project.width
    H = timeline.project.height
    media_map = {a.id: a for a in timeline.media_pool}

    ensure_default_preset()

    styles: dict[str, tuple[SubtitleStyle, bool]] = {}  # hash -> (style, has_bg)
    pil_fonts: dict[str, ImageFont.FreeTypeFont | None] = {}  # hash -> cached font
    dialogues: list[str] = []

    for track in timeline.tracks:
        if track.muted or track.type != "subtitle":
            continue
        for clip in track.clips:
            # Resolve preset + per-clip override into a full style
            style = resolve_clip_style(clip.subtitle_style_ref, clip.subtitle_style)
            sh = _style_hash(style)
            bg = style.background or "rgba(0,0,0,0.6)"
            has_bg = bool(bg and bg != "transparent")
            if sh not in styles:
                styles[sh] = (style, has_bg)
            # Load PIL font once per unique style (for precise bg measurement).
            # Use the same ×4/3 scaled size so box dimensions match the ASS
            # font size used in the text style layer.
            if sh not in pil_fonts:
                pil_fonts[sh] = _get_pil_font(
                    style.font_family or "sans-serif",
                    int(round((style.font_size or 48) * 1.3333)),
                    style.bold or False,
                )

            pos_x = int((style.position_x if style.position_x is not None else 0.5) * W)
            pos_y = int((style.position_y if style.position_y is not None else 0.85) * H)
            pf = pil_fonts[sh]

            if clip.subtitle_text:
                dialogues.extend(
                    _build_dialogues(
                        clip.subtitle_text, clip.timeline_start_sec,
                        clip.timeline_end_sec, style, sh, has_bg,
                        pos_x, pos_y, W, pf,
                    )
                )
            elif clip.media_id:
                # SRT file-backed subtitle
                asset = media_map.get(clip.media_id)
                if not asset:
                    continue
                srt_path = Path(asset.path)
                if not srt_path.is_absolute():
                    srt_path = srt_path.resolve()
                if not srt_path.exists() or srt_path.suffix.lower() != ".srt":
                    continue
                try:
                    srt_content = srt_path.read_text(encoding="utf-8")
                except Exception as e:
                    logger.warning("Failed to read SRT file %s: %s", srt_path, e)
                    continue

                entries = _parse_srt(srt_content)
                source_in = clip.source_in_sec or 0
                source_out = clip.source_out_sec
                speed = clip.speed or 1.0

                for entry in entries:
                    if entry.end_sec <= source_in:
                        continue
                    if source_out is not None and entry.start_sec >= source_out:
                        continue

                    ent_start = max(entry.start_sec, source_in)
                    ent_end = min(entry.end_sec, source_out) if source_out else entry.end_sec

                    tl_start = clip.timeline_start_sec + (ent_start - source_in) / speed
                    tl_end = clip.timeline_start_sec + (ent_end - source_in) / speed
                    tl_start = max(tl_start, clip.timeline_start_sec)
                    tl_end = min(tl_end, clip.timeline_end_sec)
                    if tl_end <= tl_start:
                        continue

                    dialogues.extend(
                        _build_dialogues(
                            _strip_srt_tags(entry.text), tl_start,
                            tl_end, style, sh, has_bg,
                            pos_x, pos_y, W, pf,
                        )
                    )

    if not dialogues:
        return None

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {W}",
        f"PlayResY: {H}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
    ]
    for sh, (style, has_bg) in sorted(styles.items()):
        if has_bg:
            lines.append(_build_style_line(f"S_{sh}_BG", style, W, mode="bg"))
            lines.append(_build_style_line(f"S_{sh}_TX", style, W, mode="text"))
        else:
            lines.append(_build_style_line(f"S_{sh}", style, W))

    lines.extend([
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    lines.extend(dialogues)
    lines.append("")

    Path(output_path).write_text("\n".join(lines), encoding="utf-8")
    logger.info("Generated ASS subtitle: %s (%d events)", output_path, len(dialogues))
    return output_path
