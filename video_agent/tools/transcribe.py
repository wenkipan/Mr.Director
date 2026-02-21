import re
import subprocess
import tempfile
from pathlib import Path

from video_agent.config import WHISPER_DEVICE, WHISPER_MODEL


def _seconds_to_ts(seconds: float) -> str:
    """Convert seconds (float) to MM:SS.mmm timestamp format."""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes:02d}:{secs:06.3f}"


def _strip_punctuation(text: str) -> str:
    """Remove Chinese and common punctuation from transcription text."""
    return re.sub(r"""[，。！？、；：\u201c\u201d\u2018\u2019「」【】…—,.!?;:'"()\[\]]""", "", text).strip()


def _update_speech_section(content: str, new_lines: list) -> str:
    """Replace the 语音转录 section in an analysis file with new content."""
    new_section_content = "\n".join(new_lines) if new_lines else "无语音"

    lines = content.split("\n")
    in_speech_section = False
    result_lines = []
    inserted = False

    for line in lines:
        if re.match(r"^## .*语音转录", line):
            in_speech_section = True
            result_lines.append(line)
            result_lines.append(new_section_content)
            inserted = True
            continue

        if in_speech_section:
            if line.startswith("## "):
                in_speech_section = False
                result_lines.append(line)
            # drop old section content lines
        else:
            result_lines.append(line)

    if not inserted:
        result_lines.append("")
        result_lines.append("## 语音转录（带时间戳）")
        result_lines.append(new_section_content)

    return "\n".join(result_lines)


def transcribe_audio(video_path: str, workspace_dir: str, language: str = "zh") -> str:
    """Transcribe speech in a video using local Whisper for frame-accurate timestamps.

    Runs Whisper locally and updates the corresponding *_analysis.md file in the
    workspace, replacing the Gemini speech transcription section with timestamps
    accurate to ~100ms (vs Gemini's ~1s). The output format is identical to the
    existing section so all downstream tools work without changes.

    Args:
        video_path: Absolute path to the video file to transcribe.
        workspace_dir: Absolute path to the workspace directory.
        language: Language code for transcription (default: "zh" for Mandarin).

    Returns:
        Success message with segment count and path of the updated analysis file.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return "ERROR: faster-whisper is not installed. Run: pip install faster-whisper"

    video_path = Path(video_path)
    workspace = Path(workspace_dir)

    # Step 1: extract audio to a temporary 16kHz mono WAV
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_audio = tmp.name

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(video_path),
                "-vn", "-ar", "16000", "-ac", "1",
                "-f", "wav", tmp_audio,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return f"ERROR: Failed to extract audio: {result.stderr}"

        # Step 2: load model and transcribe
        model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type="int8")
        segments, _info = model.transcribe(tmp_audio, language=language)

        # Step 3: convert segments to analysis format
        transcript_lines = []
        for seg in segments:
            text = _strip_punctuation(seg.text)
            if not text:
                continue
            start_ts = _seconds_to_ts(seg.start)
            end_ts = _seconds_to_ts(seg.end)
            transcript_lines.append(f'- [{start_ts} --> {end_ts}] "{text}"')

    finally:
        Path(tmp_audio).unlink(missing_ok=True)

    # Step 4: update or create _analysis.md
    analysis_path = workspace / f"{video_path.stem}_analysis.md"

    if analysis_path.exists():
        content = analysis_path.read_text(encoding="utf-8")
        updated = _update_speech_section(content, transcript_lines)
        analysis_path.write_text(updated, encoding="utf-8")
    else:
        section_content = "\n".join(transcript_lines) if transcript_lines else "无语音"
        analysis_path.write_text(
            f"## 语音转录（带时间戳）\n{section_content}\n",
            encoding="utf-8",
        )

    seg_count = len(transcript_lines)
    return (
        f"Whisper transcription complete: {seg_count} segments, "
        f"language={language}, model={WHISPER_MODEL}. "
        f"Updated: {analysis_path}"
    )
