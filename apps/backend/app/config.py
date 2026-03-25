from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM provider: "gemini" or "openai"
    llm_provider: str = "gemini"

    # Gemini settings (also used by vision tools regardless of llm_provider)
    gemini_api_key: str = ""
    gemini_base_url: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # OpenAI-compatible settings (used when llm_provider="openai")
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o"
    # Thinking/reasoning mode: "off" | "dashscope" | "deepseek"
    openai_thinking: str = "off"

    # Vision provider: "gemini" or "openai"
    # When "openai", both analyze_video and analyze_image use OpenAI-compatible API
    vision_provider: str = "gemini"
    # Empty = fallback to the matching provider's key/base_url/model
    vision_api_key: str = ""
    vision_base_url: str = ""
    vision_model: str = ""

    # TTS
    tts_provider: str = "edge"  # edge
    tts_api_key: str = ""
    tts_base_url: str = ""
    tts_default_voice: str = ""  # empty = provider decides

    whisper_model_size: str = "medium"
    whisper_device: str = "auto"
    allowed_media_dirs: list[str] = []
    projects_dir: str = "./projects"
    exports_dir: str = "./projects/exports"
    export_gl: str = "auto"  # auto | angle-egl | swangle | egl | vulkan
    ffmpeg_path: str = ""  # empty = auto-detect from PATH
    ffmpeg_max_inputs: int = 20
    cors_origins: list[str] = ["http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = {"env_file": ".env", "env_prefix": "MRDV2_"}


settings = Settings()
