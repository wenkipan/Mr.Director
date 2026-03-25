"""TTS provider factory."""

from __future__ import annotations

from app.services.tts.base import TTSProvider, TTSResult, VoiceInfo

_provider: TTSProvider | None = None


def get_tts_provider() -> TTSProvider:
    """Return singleton TTS provider based on settings."""
    global _provider
    if _provider is None:
        from app.config import settings

        match settings.tts_provider:
            case "edge":
                from app.services.tts.edge_provider import EdgeTTSProvider

                _provider = EdgeTTSProvider()
            case _:
                raise ValueError(f"Unknown TTS provider: {settings.tts_provider}")
    return _provider


__all__ = ["get_tts_provider", "TTSProvider", "TTSResult", "VoiceInfo"]
