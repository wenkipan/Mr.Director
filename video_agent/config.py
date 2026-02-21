import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY: str = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
GEMINI_BASE_URL: str = os.getenv("GEMINI_BASE_URL", "")
COMPRESS_SHORT_SIDE: int = int(os.getenv("COMPRESS_SHORT_SIDE", "720"))
COMPRESS_BITRATE: str = os.getenv("COMPRESS_BITRATE", "1M")
COMPRESS_MAX_SIZE_MB: float = float(os.getenv("COMPRESS_MAX_SIZE_MB", "20"))
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "medium")  # tiny/base/small/medium/large
WHISPER_DEVICE: str = os.getenv("WHISPER_DEVICE", "cpu")  # cpu / cuda
