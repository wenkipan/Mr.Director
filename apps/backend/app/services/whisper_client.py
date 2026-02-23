"""Whisper ASR client — lazy-loaded faster-whisper model."""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

_model: Any = None


def get_whisper_model():
    """Lazy-load the faster-whisper model on first use."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        device = settings.whisper_device
        model_size = settings.whisper_model_size

        # Pick compute type based on device
        if device == "auto":
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"

        compute_type = "float16" if device == "cuda" else "int8"

        logger.info(f"Loading Whisper model: {model_size} on {device} ({compute_type})")
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
        logger.info("Whisper model loaded")

    return _model
