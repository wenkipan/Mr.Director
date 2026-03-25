"""TTS tools: generate_speech and list_voices."""

from __future__ import annotations

import logging
import time
from pathlib import Path

from app.tools.registry import registry

logger = logging.getLogger(__name__)


@registry.register(
    name="generate_speech",
    description=(
        "Text-to-speech: synthesize text into an audio file with a specified voice. "
        "Returns the file path, duration, and sample rate of the generated audio. "
        "Use list_voices to find available voice IDs first."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "text": {"type": "STRING", "description": "Text to synthesize"},
            "voice": {
                "type": "STRING",
                "description": "Voice ID (from list_voices), e.g. 'zh-CN-YunxiNeural'",
            },
            "speed": {
                "type": "NUMBER",
                "description": "Speed multiplier, default 1.0",
            },
            "output_name": {
                "type": "STRING",
                "description": "Output filename without extension (optional, auto-generated if omitted)",
            },
        },
        "required": ["text", "voice"],
    },
)
async def generate_speech(args: dict, state) -> dict:
    text = args.get("text", "").strip()
    if not text:
        return {"error": "text is empty"}

    voice = args.get("voice", "").strip()
    if not voice:
        return {"error": "voice is required (use list_voices to find available voices)"}

    speed = float(args.get("speed", 1.0))
    if speed <= 0:
        return {"error": "speed must be positive"}

    # Determine output path
    media_dir = Path(state.media_dir) if state.media_dir else Path(".")
    output_name = args.get("output_name", "").strip()
    if not output_name:
        output_name = f"tts_{int(time.time())}"
    output_path = str(media_dir / f"{output_name}.mp3")

    try:
        from app.services.tts import get_tts_provider

        provider = get_tts_provider()
        result = await provider.synthesize(
            text=text,
            voice=voice,
            speed=speed,
            output_path=output_path,
        )
        return {
            "file_path": result.file_path,
            "duration_sec": round(result.duration_sec, 3),
            "sample_rate": result.sample_rate,
        }
    except ImportError:
        return {
            "error": "edge-tts is not installed. Install it with: pip install edge-tts",
        }
    except Exception as e:
        logger.exception("TTS synthesis failed")
        return {"error": f"TTS synthesis failed: {str(e)}"}


@registry.register(
    name="list_voices",
    description=(
        "List available TTS voices, optionally filtered by language code. "
        "Returns voice ID, name, language, and gender for each voice."
    ),
    parameters={
        "type": "OBJECT",
        "properties": {
            "language": {
                "type": "STRING",
                "description": "Filter by language code, e.g. 'zh', 'en', 'ja'. Returns all if omitted.",
            },
        },
        "required": [],
    },
)
async def list_voices(args: dict, state) -> dict:
    language = args.get("language")

    try:
        from app.services.tts import get_tts_provider

        provider = get_tts_provider()
        voices = await provider.list_voices(language=language)
        return {
            "count": len(voices),
            "voices": [
                {
                    "id": v.id,
                    "name": v.name,
                    "language": v.language,
                    "gender": v.gender,
                }
                for v in voices
            ],
        }
    except ImportError:
        return {
            "error": "edge-tts is not installed. Install it with: pip install edge-tts",
        }
    except Exception as e:
        logger.exception("list_voices failed")
        return {"error": f"list_voices failed: {str(e)}"}
