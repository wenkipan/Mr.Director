"""Read/write helpers for <media>_analysis.md files."""

from __future__ import annotations

import re
from pathlib import Path


def get_analysis_path(media_path: Path) -> Path:
    """Return the _analysis.md path for a given media file."""
    return media_path.parent / f"{media_path.stem}_analysis.md"


def append_section(media_path: Path, heading: str, content: str) -> Path:
    """Append or replace a section in the analysis markdown file.

    If a section with the same heading already exists it is replaced.
    Returns the path to the analysis file.
    """
    analysis_path = get_analysis_path(media_path)

    if analysis_path.exists():
        text = analysis_path.read_text(encoding="utf-8")
    else:
        text = f"# Media Analysis: {media_path.name}\n"

    section_block = f"\n## {heading}\n\n{content.strip()}\n"

    # Replace existing section (## heading ... up to next ## or EOF)
    pattern = re.compile(
        rf"(\n## {re.escape(heading)}\n).*?(?=\n## |\Z)",
        re.DOTALL,
    )
    if pattern.search(text):
        text = pattern.sub(section_block, text)
    else:
        text = text.rstrip() + "\n" + section_block

    analysis_path.write_text(text, encoding="utf-8")
    return analysis_path
