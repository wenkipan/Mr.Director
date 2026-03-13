"""ASR tool: transcribe_audio using faster-whisper.
Transcription results are persisted to <filename>_analysis.md."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from app.services.analysis_file import append_section
from app.tools.registry import registry

logger = logging.getLogger(__name__)


@registry.register(
    name="transcribe_audio",
    description=(
        "Transcribe speech using Whisper ASR. Returns word-level timestamps and full transcript. "
        "Includes LLM post-correction for mispronunciation errors. "
        "Results auto-saved to <filename>_analysis.md (check for existing file first). "
        "\n\nIMPORTANT: Returned timestamps are in SOURCE TIME (positions within the original media file), "
        "NOT timeline time. After any cut or rearrangement, use map_time to convert. "
        "\n\nWhen to use: getting speech content and timestamps for subtitle generation, "
        "transcript-based editing (removing bad takes, filler words), rough-cut assembly. "
        "When NOT to use: analyzing visual content (use analyze_video)."
    ),
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

        # LLM post-correction: fix mispronunciation errors
        try:
            await _correct_transcription(result)
        except Exception:
            logger.warning("LLM transcription correction failed, using original", exc_info=True)

        # Persist to _analysis.md
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


_CORRECTION_SYSTEM_PROMPT = """\
You are a transcription correction expert. You will receive speech-to-text \
transcription segments that may contain errors caused by mispronunciation, \
homophones, or similar-sounding words.

Rules:
- Fix obvious speech-recognition errors (wrong characters/words caused by \
similar pronunciation) based on context.
- Do NOT change the speaker's original meaning, word order, or style.
- If a segment has no errors, return it unchanged.
- Return ONLY a JSON array of corrected strings, one per input segment, \
in the same order. No explanation, no markdown fences."""


async def _correct_transcription(result: dict) -> None:
    """Call LLM to fix mispronunciation errors in transcription segments.

    Modifies *result* in-place. On any failure, logs a warning and leaves
    the original transcription untouched.
    """
    segments = result.get("segments", [])
    if not segments:
        return

    from app.services.llm import get_provider

    provider = get_provider()

    # Build user message: numbered segment texts
    numbered = "\n".join(f"{i}: {seg['text']}" for i, seg in enumerate(segments))
    user_msg = (
        f"Language: {result.get('language', 'unknown')}\n"
        f"Transcription segments:\n{numbered}"
    )

    try:
        resp = await provider.generate(
            messages=[{"role": "user", "content": user_msg}],
            system_prompt=_CORRECTION_SYSTEM_PROMPT,
            tools=[],
            temperature=0.3,
        )
    except Exception:
        logger.warning("LLM correction call failed, using original transcription", exc_info=True)
        return

    if not resp.text:
        logger.warning("LLM returned empty response for transcription correction")
        return

    # Parse JSON array from response (strip possible markdown fences)
    raw = resp.text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        corrected: list[str] = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM correction response: %s", raw[:200])
        return

    if not isinstance(corrected, list) or len(corrected) != len(segments):
        logger.warning(
            "LLM correction count mismatch: got %s, expected %d",
            len(corrected) if isinstance(corrected, list) else type(corrected).__name__,
            len(segments),
        )
        return

    # Apply corrections
    corrected_parts = []
    for seg, new_text in zip(segments, corrected):
        if isinstance(new_text, str) and new_text.strip():
            seg["text"] = new_text.strip()
        corrected_parts.append(seg["text"])

    result["full_text"] = " ".join(corrected_parts)
    logger.info("LLM transcription correction applied to %d segments", len(segments))


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
        "| Start Time | End Time | Text |",
        "|-------|-----|------|",
    ]
    for seg in result["segments"]:
        lines.append(f"| {seg['start']:.3f} | {seg['end']:.3f} | {seg['text']} |")
    return "\n".join(lines)
