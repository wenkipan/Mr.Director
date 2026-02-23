from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_base_url: str = ""
    gemini_model: str = "gemini-2.5-flash"
    whisper_model_size: str = "medium"
    whisper_device: str = "auto"
    allowed_media_dirs: list[str] = []
    projects_dir: str = "./projects"
    cors_origins: list[str] = ["http://localhost:5173"]
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = {"env_file": ".env", "env_prefix": "MRDV2_"}


settings = Settings()
