"""Vision tools: analyze_video, analyze_image.

Dispatches to Gemini or OpenAI based on MRDV2_VISION_PROVIDER.
- gemini: Uses Gemini Files API / inline bytes (existing behaviour)
- openai: Uses OpenAI /v1/files upload / base64 inline fallback

Analysis results are persisted to <filename>_analysis.md."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from pathlib import Path

from app.services.analysis_file import append_section
from app.services.video_compress import compress_for_analysis
from app.config import settings
from app.tools.registry import registry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared prompts
# ---------------------------------------------------------------------------

FOCUS_PROMPTS = {
    "general": (
        "Analyze this video comprehensively. Describe:\n"
        "1. Overall content and subject matter\n"
        "2. Key scenes with approximate timestamps\n"
        "3. Visual style, lighting, camera movements\n"
        "4. Pacing and rhythm\n"
        "5. Notable moments that would be good edit points\n"
        "6. Any text, titles, or graphics visible"
    ),
    "scenes": (
        "Break this video down into individual scenes. For each scene provide:\n"
        "- Approximate start and end timestamps\n"
        "- Description of what happens\n"
        "- Visual characteristics (wide shot, close-up, etc.)\n"
        "- Suggested edit points (natural cuts, transitions)"
    ),
    "pacing": (
        "Analyze the pacing and rhythm of this video:\n"
        "- Where does the energy/action peak?\n"
        "- Where are the slow/quiet moments?\n"
        "- What is the overall tempo?\n"
        "- Suggest timestamps for speed changes, cuts, or emphasis"
    ),
    "content": (
        "Focus on the content and meaning of this video:\n"
        "- What is the main subject/story?\n"
        "- Who/what appears in the video?\n"
        "- What is the mood/tone?\n"
        "- Are there any spoken words or dialogue? (describe what you can observe)\n"
        "- Key moments that convey the main message"
    ),
}


def _is_openai_vision() -> bool:
    return settings.vision_provider == "openai"


# ===================================================================
# Gemini helpers (unchanged from original gemini_vision.py)
# ===================================================================

def _gemini_use_files_api() -> bool:
    """Use Files API only when talking to the official Gemini endpoint."""
    base_url = settings.vision_base_url or settings.gemini_base_url
    return not base_url


def _get_gemini_client():
    from app.services.gemini_client import get_client
    return get_client()


def _get_gemini_model() -> str:
    return settings.vision_model or settings.gemini_model


async def _gemini_upload_via_files_api(client, file_path: Path):
    """Upload a file via the Gemini Files API and wait for processing."""
    logger.info("Uploading to Gemini Files API: %s", file_path)
    uploaded_file = client.files.upload(
        file=str(file_path),
        config={"display_name": file_path.name},
    )

    max_wait = 120
    waited = 0
    while uploaded_file.state.name == "PROCESSING" and waited < max_wait:
        await asyncio.sleep(3)
        waited += 3
        uploaded_file = client.files.get(name=uploaded_file.name)
        logger.info("File processing... (%ds)", waited)

    if uploaded_file.state.name == "FAILED":
        raise RuntimeError("Gemini failed to process the file.")
    if uploaded_file.state.name != "ACTIVE":
        raise RuntimeError(
            f"File processing timed out after {max_wait}s. "
            f"State: {uploaded_file.state.name}"
        )

    logger.info("File uploaded and ready: %s", uploaded_file.name)
    return uploaded_file


async def _gemini_analyze(file_path: Path, prompt: str, is_video: bool) -> str:
    """Run analysis via Gemini SDK."""
    from google.genai.types import Part

    client = _get_gemini_client()

    if _gemini_use_files_api():
        file_part = await _gemini_upload_via_files_api(client, file_path)
    else:
        logger.info("Using inline bytes: %s", file_path)
        fallback = "video/mp4" if is_video else "image/jpeg"
        mime_type = mimetypes.guess_type(str(file_path))[0] or fallback
        file_part = Part.from_bytes(data=file_path.read_bytes(), mime_type=mime_type)

    response = client.models.generate_content(
        model=_get_gemini_model(),
        contents=[file_part, prompt],
    )
    return response.text


# ===================================================================
# OpenAI helper
# ===================================================================

async def _openai_analyze(file_path: Path, prompt: str, is_video: bool) -> str:
    """Run analysis via OpenAI-compatible API."""
    from app.services.openai_vision import get_openai_vision_client

    client = get_openai_vision_client()
    # Sync call — runs in the default executor to avoid blocking the loop
    import asyncio
    return await asyncio.get_running_loop().run_in_executor(
        None, client.analyze, file_path, prompt, is_video
    )


# ===================================================================
# Tool: analyze_video
# ===================================================================

@registry.register(
    name="analyze_video",
    description=(
        "Analyze a video file using vision model (Gemini or OpenAI). "
        "Returns scene descriptions, timestamps, visual content, pacing. "
        "Results auto-saved to <filename>_analysis.md (check for existing file first to avoid re-analysis). "
        "Video is compressed to 720p before sending. "
        "\n\nWhen to use: understanding video content for editing decisions — scene breakdowns, finding edit points, "
        "identifying visual elements. "
        "When NOT to use: getting technical metadata like codec/resolution/duration (use run_shell with ffprobe), "
        "transcribing speech (use transcribe_audio)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "file_path": {"type": "STRING", "description": "Absolute path to video file"},
            "analysis_focus": {
                "type": "STRING",
                "description": "What to focus on: 'general', 'scenes', 'pacing', 'content'. Default: 'general'",
            },
        },
        "required": ["file_path"],
    },
)
async def analyze_video(args: dict, state) -> dict:
    file_path = Path(args["file_path"]).resolve()
    if not file_path.is_file():
        return {"error": f"File not found: {args['file_path']}"}

    focus = args.get("analysis_focus", "general")
    prompt = FOCUS_PROMPTS.get(focus, FOCUS_PROMPTS["general"])

    compressed_path: Path | None = None

    try:
        compressed_path = await compress_for_analysis(file_path)
        send_path = compressed_path

        if _is_openai_vision():
            analysis_text = await _openai_analyze(send_path, prompt, is_video=True)
        else:
            analysis_text = await _gemini_analyze(send_path, prompt, is_video=True)

        section = f"Video Analysis ({focus})"
        md_path = append_section(file_path, section, analysis_text)
        logger.info("Analysis saved to %s", md_path)

        return {
            "file": str(file_path),
            "focus": focus,
            "analysis": analysis_text,
            "analysis_file": str(md_path),
        }

    except Exception as e:
        logger.exception("Video analysis failed")
        return {"error": f"Video analysis failed: {str(e)}"}
    finally:
        if compressed_path:
            compressed_path.unlink(missing_ok=True)


# ===================================================================
# Tool: analyze_image
# ===================================================================

@registry.register(
    name="analyze_image",
    description=(
        "Analyze an image file using vision model (Gemini or OpenAI). "
        "Returns description of visual content. Results auto-saved to <filename>_analysis.md. "
        "\n\nWhen to use: understanding image content for overlay, thumbnail, or title card decisions. "
        "When NOT to use: analyzing video content (use analyze_video)."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "file_path": {"type": "STRING", "description": "Absolute path to image file"},
            "question": {
                "type": "STRING",
                "description": "Optional specific question about the image",
            },
        },
        "required": ["file_path"],
    },
)
async def analyze_image(args: dict, state) -> dict:
    file_path = Path(args["file_path"]).resolve()
    if not file_path.is_file():
        return {"error": f"File not found: {args['file_path']}"}

    question = args.get("question", "")
    prompt = question or (
        "Describe this image in detail: subject, composition, colors, "
        "lighting, mood, and any text or notable elements."
    )

    try:
        if _is_openai_vision():
            analysis_text = await _openai_analyze(file_path, prompt, is_video=False)
        else:
            analysis_text = await _gemini_analyze(file_path, prompt, is_video=False)

        md_path = append_section(file_path, "Image Analysis", analysis_text)
        logger.info("Analysis saved to %s", md_path)

        return {
            "file": str(file_path),
            "analysis": analysis_text,
            "analysis_file": str(md_path),
        }

    except Exception as e:
        logger.exception("Image analysis failed")
        return {"error": f"Image analysis failed: {str(e)}"}
