"""ASS subtitle generation from TimelineProject."""

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from app.models.timeline import TimelineProject, SubtitleStyle, resolve_subtitle_style
from app.services.subtitle_styles import load_preset, ensure_default_preset

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
    m = re.match(r"#([0-9a-fA-F]{6,8})", css)
    if m:
        h = m.group(1)
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


def _escape_ass_text(text: str) -> str:
    """Escape special characters for ASS dialogue text."""
    return (
        text.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", "\\N")
    )


def _style_hash(s: SubtitleStyle) -> str:
    key = s.model_dump_json(exclude_none=True)
    return hashlib.md5(key.encode()).hexdigest()[:8]


def _build_style_line(name: str, s: SubtitleStyle) -> str:
    """Build one ASS ``[V4+ Styles]`` line.

    Uses BorderStyle=3 (opaque box) when background is set,
    BorderStyle=1 (outline + shadow) otherwise.
    """
    primary = _css_to_ass_color(s.color or "#FFFFFF")
    secondary = "&H00000000&"

    bg = s.background or "rgba(0,0,0,0.6)"
    has_outline = (s.outline_width or 0) > 0 and s.outline_color and s.outline_color != "transparent"
    has_bg = bg and bg != "transparent"

    if has_outline:
        outline_color = _css_to_ass_color(s.outline_color or "#000000")
    else:
        outline_color = "&H00000000&"

    back = _css_to_ass_color(bg) if has_bg else "&H00000000&"
    bold = -1 if s.bold else 0
    italic = -1 if s.italic else 0
    alignment = {"left": 4, "center": 5, "right": 6}.get(s.text_align or "center", 5)
    spacing = s.letter_spacing or 0

    # BorderStyle: 3 = opaque box (uses BackColour), 1 = outline + drop shadow
    border_style = 3 if has_bg else 1
    outline_width = s.outline_width or 0
    shadow_dist = 0  # We use \pos for positioning; ASS shadow is a simple offset

    return (
        f"Style: {name},{s.font_family or 'sans-serif'},{s.font_size or 48},"
        f"{primary},{secondary},{outline_color},{back},"
        f"{bold},{italic},0,0,100,100,{spacing},0,"
        f"{border_style},{outline_width},{shadow_dist},{alignment},0,0,0,1"
    )


# ── public API ──────────────────────────────────────────────


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

    styles: dict[str, tuple[str, SubtitleStyle]] = {}  # hash -> (name, style)
    dialogues: list[str] = []

    for track in timeline.tracks:
        if track.muted or track.type != "subtitle":
            continue
        for clip in track.clips:
            # Resolve preset + per-clip override into a full style
            if clip.subtitle_style_ref:
                preset = load_preset(clip.subtitle_style_ref)
                style = resolve_subtitle_style(preset, clip.subtitle_style)
            else:
                style = clip.subtitle_style or SubtitleStyle()
            sh = _style_hash(style)
            style_name = f"S_{sh}"
            if sh not in styles:
                styles[sh] = (style_name, style)

            pos_x = int((style.position_x if style.position_x is not None else 0.5) * W)
            pos_y = int((style.position_y if style.position_y is not None else 0.85) * H)
            tags = f"{{\\pos({pos_x},{pos_y})}}"

            if clip.subtitle_text:
                dialogues.append(
                    f"Dialogue: 0,{_sec_to_ass_time(clip.timeline_start_sec)},"
                    f"{_sec_to_ass_time(clip.timeline_end_sec)},{style_name},,0,0,0,,"
                    f"{tags}{_escape_ass_text(clip.subtitle_text)}"
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

                    dialogues.append(
                        f"Dialogue: 0,{_sec_to_ass_time(tl_start)},"
                        f"{_sec_to_ass_time(tl_end)},{style_name},,0,0,0,,"
                        f"{tags}{_escape_ass_text(_strip_srt_tags(entry.text))}"
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
    for _, (name, style) in sorted(styles.items()):
        lines.append(_build_style_line(name, style))

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
