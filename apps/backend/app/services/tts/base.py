"""Abstract base class for TTS providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TTSResult:
    file_path: str
    duration_sec: float
    sample_rate: int


@dataclass
class VoiceInfo:
    id: str  # pass to synthesize() as voice parameter
    name: str  # human-readable display name
    language: str  # e.g. zh-CN, en-US
    gender: str  # male / female


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: str,
        speed: float,
        output_path: str,
    ) -> TTSResult:
        """Synthesize speech, write to output_path, return metadata."""
        ...

    @abstractmethod
    async def list_voices(
        self,
        language: str | None = None,
    ) -> list[VoiceInfo]:
        """List available voices, optionally filtered by language."""
        ...
