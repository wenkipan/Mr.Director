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

    whisper_model_size: str = "medium"
    whisper_device: str = "auto"
    allowed_media_dirs: list[str] = []
    projects_dir: str = "./projects"
    exports_dir: str = "./projects/exports"
    cors_origins: list[str] = ["http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = {"env_file": ".env", "env_prefix": "MRDV2_"}


settings = Settings()
