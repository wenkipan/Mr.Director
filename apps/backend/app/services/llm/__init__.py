"""LLM provider abstraction layer."""

from app.services.llm.base import LLMProvider, LLMResponse, ToolCall

__all__ = ["LLMProvider", "LLMResponse", "ToolCall", "get_provider"]


_provider: LLMProvider | None = None


def get_provider() -> LLMProvider:
    """Get the configured LLM provider (singleton)."""
    global _provider
    if _provider is None:
        from app.config import settings

        if settings.llm_provider == "openai":
            from app.services.llm.openai_provider import OpenAIProvider

            _provider = OpenAIProvider(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url or None,
                model=settings.openai_model,
                thinking=settings.openai_thinking,
            )
        else:
            from app.services.llm.gemini_provider import GeminiProvider

            _provider = GeminiProvider()

    return _provider
