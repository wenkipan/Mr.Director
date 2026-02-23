"""Gemini API client wrapper."""

from __future__ import annotations

from google import genai
from google.genai.types import GenerateContentConfig, Content, Part

from app.config import settings


_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        kwargs: dict = {"api_key": settings.gemini_api_key}
        if settings.gemini_base_url:
            kwargs["http_options"] = {"base_url": settings.gemini_base_url}
        _client = genai.Client(**kwargs)
    return _client
