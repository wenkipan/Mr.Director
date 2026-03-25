"""Edge-TTS provider — free, zero API key, rich voice library."""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from pathlib import Path

from app.services.tts.base import TTSProvider, TTSResult, VoiceInfo

logger = logging.getLogger(__name__)


class EdgeTTSProvider(TTSProvider):
    async def synthesize(
        self,
        text: str,
        voice: str,
        speed: float,
        output_path: str,
    ) -> TTSResult:
        import edge_tts

        rate_str = _speed_to_rate_str(speed)
        communicate = edge_tts.Communicate(text, voice, rate=rate_str)
        await communicate.save(output_path)

        duration, sample_rate = await asyncio.get_event_loop().run_in_executor(
            None, _probe_audio, output_path
        )

        return TTSResult(
            file_path=output_path,
            duration_sec=duration,
            sample_rate=sample_rate,
        )

    async def list_voices(
        self,
        language: str | None = None,
    ) -> list[VoiceInfo]:
        import edge_tts

        voices = await edge_tts.list_voices()
        result = []
        for v in voices:
            locale: str = v.get("Locale", "")
            if language:
                # match "zh" against "zh-CN", or exact "zh-CN"
                if not locale.lower().startswith(language.lower()):
                    continue
            result.append(
                VoiceInfo(
                    id=v["ShortName"],
                    name=v.get("FriendlyName", v["ShortName"]),
                    language=locale,
                    gender=v.get("Gender", "unknown").lower(),
                )
            )
        return result


def _speed_to_rate_str(speed: float) -> str:
    """Convert speed multiplier to edge-tts rate string like '+50%' or '-20%'."""
    pct = round((speed - 1.0) * 100)
    if pct >= 0:
        return f"+{pct}%"
    return f"{pct}%"


def _probe_audio(path: str) -> tuple[float, int]:
    """Probe audio file for duration and sample rate via ffprobe."""
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                path,
            ],
            stderr=subprocess.STDOUT,
        )
        info = json.loads(out)
        duration = float(info.get("format", {}).get("duration", 0))
        sample_rate = 24000  # edge-tts default
        for stream in info.get("streams", []):
            if stream.get("codec_type") == "audio":
                sample_rate = int(stream.get("sample_rate", sample_rate))
                break
        return duration, sample_rate
    except Exception:
        logger.warning("ffprobe failed for %s, using defaults", path)
        return 0.0, 24000
