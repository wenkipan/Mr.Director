import asyncio
from pathlib import Path


def tts(
    text: str,
    output_name: str,
    workspace_dir: str,
    voice: str = "zh-CN-XiaoxiaoNeural",
    rate: str = "+0%",
    volume: str = "+0%",
) -> str:
    """Convert text to speech and save as MP3.

    Use this to generate voiceover / narration audio from a script.
    After generating the MP3, use the shell tool with ffmpeg to mix it into a video.

    Common ffmpeg mixing patterns (use shell tool):
      Replace original audio:
        ffmpeg -i video.mp4 -i voice.mp3 -map 0:v -map 1:a -c:v copy -shortest output.mp4
      Overlay / blend with original audio:
        ffmpeg -i video.mp4 -i voice.mp3 -filter_complex "[0:a][1:a]amix=inputs=2:duration=first" -c:v copy output.mp4

    Common Chinese voices:
      - zh-CN-XiaoxiaoNeural  (female, natural & lively — default)
      - zh-CN-YunxiNeural     (male, calm & steady)
      - zh-CN-XiaoyiNeural    (female, energetic)
      - zh-CN-YunjianNeural   (male, broadcast style)
      - zh-TW-HsiaoChenNeural (female, Traditional Chinese / Taiwan accent)

    Rate and volume use ±N% format, e.g. "+10%" speeds up by 10%, "-20%" slows down.

    Args:
        text: The text to synthesize. Can be multiple sentences.
        output_name: Filename for the output audio, should end with .mp3.
        workspace_dir: Absolute path to the workspace directory.
        voice: Edge TTS voice name (default: zh-CN-XiaoxiaoNeural).
        rate: Speech rate adjustment, e.g. "+0%", "+10%", "-20%" (default: "+0%").
        volume: Volume adjustment, e.g. "+0%", "+20%", "-10%" (default: "+0%").

    Returns:
        Absolute path to the generated MP3 file, or an error message starting with "ERROR:".
    """
    try:
        import edge_tts
    except ImportError:
        return "ERROR: edge-tts is not installed. Run: pip install edge-tts"

    out = Path(workspace_dir) / output_name

    async def _generate() -> None:
        communicate = edge_tts.Communicate(text, voice, rate=rate, volume=volume)
        await communicate.save(str(out))

    try:
        asyncio.run(_generate())
    except Exception as e:
        return f"ERROR: {e}"

    if not out.exists():
        return "ERROR: Output file was not created."

    return str(out)
