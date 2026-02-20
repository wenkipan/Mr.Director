import re
import subprocess
from pathlib import Path

# Chinese + English clause-ending punctuation
_CLAUSE_PUNCT = re.compile(r'[，。！？…、；：,!?;:]+')


# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------

def _srt_ts_to_ms(ts: str) -> int:
    """Convert SRT timestamp HH:MM:SS,mmm to milliseconds."""
    hms, ms_str = ts.strip().split(",")
    h, m, s = hms.split(":")
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(ms_str)


def _ms_to_srt_ts(ms: int) -> str:
    """Convert milliseconds to SRT timestamp HH:MM:SS,mmm."""
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _hex_to_ass(hex_color: str) -> str:
    """Convert #RRGGBB to ASS &H00BBGGRR format."""
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def _srt_ts_to_ass(ts: str) -> str:
    """Convert SRT timestamp 00:00:01,500 → ASS 0:00:01.50."""
    hms, ms = ts.strip().split(",")
    h, m, s = hms.split(":")
    return f"{int(h)}:{m}:{s}.{int(ms) // 10:02d}"


# ---------------------------------------------------------------------------
# Clause splitting
# ---------------------------------------------------------------------------

def _split_text_by_clause(text: str) -> list[str]:
    """Split subtitle text on clause punctuation, skipping inside [[...]] markers.

    Returns a list of clause strings with punctuation removed.
    """
    parts: list[str] = []
    current = ""
    i = 0
    while i < len(text):
        if text[i : i + 2] == "[[":
            end = text.find("]]", i + 2)
            if end != -1:
                current += text[i : end + 2]
                i = end + 2
                continue
        if _CLAUSE_PUNCT.match(text[i]):
            if current.strip():
                parts.append(current.strip())
            current = ""
            # Skip consecutive punctuation chars
            while i < len(text) and _CLAUSE_PUNCT.match(text[i]):
                i += 1
            continue
        current += text[i]
        i += 1
    if current.strip():
        parts.append(current.strip())
    return parts


def _visible_len(text: str) -> int:
    """Character length excluding [[]] markup."""
    return len(re.sub(r"\[\[|\]\]", "", text))


def _split_srt_by_clause(subtitle_text: str) -> str:
    """Re-index an SRT string splitting each entry at clause punctuation.

    Punctuation characters are removed from displayed text.
    Time is distributed proportionally by visible character count.
    """
    new_entries: list[str] = []
    idx = 1

    for entry in re.split(r"\n\s*\n", subtitle_text.strip()):
        lines = entry.strip().splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            continue

        start_srt, end_srt = [t.strip() for t in lines[1].split("-->")]
        start_ms = _srt_ts_to_ms(start_srt)
        end_ms = _srt_ts_to_ms(end_srt)
        text = " ".join(lines[2:])

        parts = _split_text_by_clause(text)
        if not parts:
            continue

        total_chars = sum(_visible_len(p) for p in parts) or 1
        total_ms = end_ms - start_ms
        cur_ms = start_ms

        for i, part in enumerate(parts):
            if i == len(parts) - 1:
                part_end_ms = end_ms
            else:
                part_end_ms = cur_ms + max(
                    200, int(total_ms * _visible_len(part) / total_chars)
                )
                part_end_ms = min(part_end_ms, end_ms)

            new_entries.append(
                f"{idx}\n"
                f"{_ms_to_srt_ts(cur_ms)} --> {_ms_to_srt_ts(part_end_ms)}\n"
                f"{part}"
            )
            idx += 1
            cur_ms = part_end_ms

    return "\n\n".join(new_entries)


# ---------------------------------------------------------------------------
# ASS conversion (for [[highlight]] inline coloring)
# ---------------------------------------------------------------------------

def _srt_to_ass(text: str, font_size: int, margin_lr: int,
                primary_color: str, outline_color: str,
                highlight_color: str) -> str:
    """Convert SRT text (with optional [[highlight]] markup) to ASS format."""
    primary_ass = _hex_to_ass(primary_color)
    outline_ass = _hex_to_ass(outline_color)
    highlight_ass = _hex_to_ass(highlight_color)

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,Arial,{font_size},{primary_ass},&H000000FF,"
        f"{outline_ass},&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,"
        f"{margin_lr},{margin_lr},20,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    dialogues = []
    for entry in re.split(r"\n\s*\n", text.strip()):
        lines = entry.strip().splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            continue
        start_srt, end_srt = [t.strip() for t in lines[1].split("-->")]
        start = _srt_ts_to_ass(start_srt)
        end = _srt_ts_to_ass(end_srt)
        body = r"\N".join(lines[2:])
        body = re.sub(
            r"\[\[(.+?)\]\]",
            lambda m: f"{{\\c{highlight_ass}&}}{m.group(1)}{{\\r}}",
            body,
        )
        dialogues.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{body}")

    return header + "\n".join(dialogues) + "\n"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_subtitles(
    video_path: str,
    subtitle_text: str,
    output_name: str,
    workspace_dir: str,
    font_size: int = 24,
    margin_lr: int = 40,
    primary_color: str = "#FFFFFF",
    outline_color: str = "#000000",
    highlight_color: str = "#FFFF00",
    split_clauses: bool = True,
) -> str:
    """Burn subtitles into a video using FFmpeg.

    Args:
        video_path: Absolute path to the input video.
        subtitle_text: Subtitle content in SRT format. Wrap words/phrases with
            [[double brackets]] to highlight them in highlight_color.
            Punctuation used as clause delimiters (，。！？,!? etc.) should NOT
            appear inside [[...]] brackets.
            Example line: "这个 [[AI工具]] 真的太好用了，感谢大家"
        output_name: Name for the output file.
        workspace_dir: Absolute path to the workspace directory.
        font_size: Font size for subtitles (default 24).
        margin_lr: Left and right margin in pixels. Default 40. Recommended:
            - Landscape 1920×1080: 40–60
            - Vertical 1080×1920: 60–100
            - Vertical 720×1280: 50–80
        primary_color: Default subtitle text color in #RRGGBB hex (default "#FFFFFF" white).
        outline_color: Subtitle outline color in #RRGGBB hex (default "#000000" black).
        highlight_color: Color for [[bracketed]] words in #RRGGBB hex (default "#FFFF00" yellow).
        split_clauses: If True (default), split each SRT entry at clause punctuation
            (，。！？…,!? etc.) into separate subtitle entries shown one at a time,
            and remove the punctuation from the displayed text.

    Returns:
        Path to the video with subtitles.
    """
    ws = Path(workspace_dir)
    stem = Path(output_name).stem
    out = ws / output_name

    if split_clauses:
        subtitle_text = _split_srt_by_clause(subtitle_text)

    has_highlights = bool(re.search(r"\[\[.+?\]\]", subtitle_text))

    if has_highlights:
        ass_content = _srt_to_ass(
            subtitle_text, font_size, margin_lr,
            primary_color, outline_color, highlight_color,
        )
        sub_file = ws / f"{stem}.ass"
        sub_file.write_text(ass_content, encoding="utf-8")
        sub_escaped = str(sub_file).replace("'", r"'\''").replace(":", r"\:")
        vf = f"ass='{sub_escaped}'"
    else:
        srt_file = ws / f"{stem}.srt"
        srt_file.write_text(subtitle_text, encoding="utf-8")
        srt_escaped = str(srt_file).replace("'", r"'\''").replace(":", r"\:")
        force_style = (
            f"FontSize={font_size},"
            f"MarginL={margin_lr},MarginR={margin_lr},MarginV=20,"
            f"Alignment=2,WrapStyle=0,"
            f"PrimaryColour={_hex_to_ass(primary_color)},"
            f"OutlineColour={_hex_to_ass(outline_color)},"
            f"Outline=1,Shadow=0"
        )
        vf = f"subtitles='{srt_escaped}':force_style='{force_style}'"

    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", vf,
        "-c:a", "copy",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return f"ERROR: {result.stderr[-500:]}"
    return str(out)
