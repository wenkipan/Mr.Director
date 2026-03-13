"""OpenAI-compatible vision client for video/image analysis.

Uses /v1/files for upload when talking to the official endpoint.
Falls back to base64 inline when a custom base_url is configured (proxy mode).
"""

from __future__ import annotations

import base64
import logging
import mimetypes
from pathlib import Path

from openai import OpenAI

logger = logging.getLogger(__name__)


class OpenAIVisionClient:
    """Stateless helper — create once, call analyze() for each file."""

    def __init__(self, api_key: str, base_url: str = "", model: str = "gpt-4o"):
        kwargs: dict = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = OpenAI(**kwargs)
        self.model = model
        self._use_files_api = self._probe_files_api()

    def _probe_files_api(self) -> bool:
        """Send a lightweight request to check if the endpoint supports /v1/files."""
        try:
            self.client.files.list(limit=1)
            logger.info("Files API probe succeeded — will use /v1/files for uploads")
            return True
        except Exception as e:
            logger.info("Files API probe failed (%s) — will use base64 inline", e)
            return False

    def analyze(self, file_path: Path, prompt: str, is_video: bool = True) -> str:
        """Analyze a file (video or image) and return the model's text response."""
        if self._use_files_api:
            return self._analyze_via_files(file_path, prompt)
        return self._analyze_via_inline(file_path, prompt, is_video)

    # ------------------------------------------------------------------
    # /v1/files upload path
    # ------------------------------------------------------------------

    def _analyze_via_files(self, file_path: Path, prompt: str) -> str:
        logger.info("Uploading to /v1/files: %s", file_path)
        with open(file_path, "rb") as f:
            file_object = self.client.files.create(file=f, purpose="file-extract")

        try:
            logger.info("File uploaded: %s", file_object.id)
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "file",
                                "file_url": {
                                    "url": f"fileid://{file_object.id}",
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            )
            return response.choices[0].message.content
        finally:
            try:
                self.client.files.delete(file_object.id)
                logger.info("Deleted remote file: %s", file_object.id)
            except Exception:
                logger.warning("Failed to delete remote file: %s", file_object.id)

    # ------------------------------------------------------------------
    # base64 inline fallback (proxy / custom base_url)
    # ------------------------------------------------------------------

    def _analyze_via_inline(
        self, file_path: Path, prompt: str, is_video: bool
    ) -> str:
        mime_type = mimetypes.guess_type(str(file_path))[0]
        if not mime_type:
            mime_type = "video/mp4" if is_video else "image/jpeg"

        data_b64 = base64.b64encode(file_path.read_bytes()).decode()
        data_url = f"data:{mime_type};base64,{data_b64}"

        if is_video:
            file_content = {"type": "video_url", "video_url": {"url": data_url}}
        else:
            file_content = {"type": "image_url", "image_url": {"url": data_url}}

        logger.info("Sending inline base64 (%s): %s", mime_type, file_path)
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": [file_content, {"type": "text", "text": prompt}],
                }
            ],
        )
        return response.choices[0].message.content


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_client: OpenAIVisionClient | None = None


def get_openai_vision_client() -> OpenAIVisionClient:
    """Return a lazily-initialised OpenAI vision client using resolved config."""
    global _client
    if _client is None:
        from app.config import settings

        api_key = settings.vision_api_key or settings.openai_api_key
        base_url = settings.vision_base_url or settings.openai_base_url
        model = settings.vision_model or settings.openai_model

        if not api_key:
            raise RuntimeError(
                "No API key for OpenAI vision. "
                "Set MRDV2_VISION_API_KEY or MRDV2_OPENAI_API_KEY."
            )
        _client = OpenAIVisionClient(api_key=api_key, base_url=base_url, model=model)
    return _client
