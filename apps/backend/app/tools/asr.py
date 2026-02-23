"""ASR tool: transcribe_audio using faster-whisper.
Transcription results are persisted to <filename>.analysis.md."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from app.services.analysis_file import append_section
from app.tools.registry import registry

logger = logging.getLogger(__name__)


@registry.register(
    name="transcribe_audio",
    description="Transcribe speech in a video/audio file using Whisper ASR. "
    "Returns word-level timestamps and full transcript. "
    "Results are saved to <filename>.analysis.md.",
    parameters={
        "type": "OBJECT",
        "properties": {
            "file_path": {"type": "STRING", "description": "Absolute path to video/audio file"},
            "language": {
                "type": "STRING",
                "description": "ISO 639-1 language code, e.g. 'en', 'zh'. Auto-detect if not specified.",
            },
        },
        "required": ["file_path"],
    },
)
async def transcribe_audio(args: dict, state) -> dict:
    file_path = Path(args["file_path"]).resolve()
    if not file_path.is_file():
        return {"error": f"File not found: {args['file_path']}"}

    language = args.get("language")

    try:
        # Run transcription in a thread pool to avoid blocking the event loop
        result = await asyncio.get_event_loop().run_in_executor(
            None, _transcribe_sync, str(file_path), language
        )

        # Persist to .analysis.md
        md_path = append_section(file_path, "Transcription", _format_transcription_md(result))
        result["analysis_file"] = str(md_path)
        logger.info(f"Transcription saved to {md_path}")

        return result
    except ImportError:
        return {
            "error": "faster-whisper is not installed. "
            "Install it with: pip install faster-whisper",
        }
    except Exception as e:
        logger.exception("Transcription failed")
        return {"error": f"Transcription failed: {str(e)}"}


def _transcribe_sync(file_path: str, language: str | None) -> dict:
    """Synchronous transcription — runs in thread pool."""
    from app.services.whisper_client import get_whisper_model

    model = get_whisper_model()

    segments_iter, info = model.transcribe(
        file_path,
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )

    segments = []
    full_text_parts = []

    for segment in segments_iter:
        words = []
        if segment.words:
            words = [
                {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
                for w in segment.words
            ]

        seg_data = {
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text.strip(),
        }
        if words:
            seg_data["words"] = words

        segments.append(seg_data)
        full_text_parts.append(segment.text.strip())

    return {
        "file": file_path,
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration_sec": round(info.duration, 3),
        "segment_count": len(segments),
        "full_text": " ".join(full_text_parts),
        "segments": segments,
    }


def _format_transcription_md(result: dict) -> str:
    """Format transcription result as Markdown for the analysis file."""
    lines = [
        f"- Language: {result['language']} ({result['language_probability']})",
        f"- Duration: {result['duration_sec']}s",
        f"- Segments: {result['segment_count']}",
        "",
        "### Full Text",
        "",
        result["full_text"],
        "",
        "### Segments",
        "",
        "| Start | End | Text |",
        "|-------|-----|------|",
    ]
    for seg in result["segments"]:
        lines.append(f"| {seg['start']:.3f} | {seg['end']:.3f} | {seg['text']} |")
    return "\n".join(lines)
