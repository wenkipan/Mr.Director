from pathlib import Path

from google import genai
from google.genai import types

from video_agent.config import GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL


def analyze_video(video_path: str, workspace_dir: str) -> str:
    """Analyze video content using Gemini vision. Generates timestamped
    summary and speech transcription saved as a markdown file.

    Internally compresses the video before uploading to Gemini to reduce
    upload size; the original file is not modified.

    Args:
        video_path: Absolute path to the original video file to analyze.
        workspace_dir: Absolute path to the workspace directory.

    Returns:
        The analysis content (also saved as markdown file in workspace).
    """
    from video_agent.tools.compress import compress_video

    http_options = {"api_version": "v1beta"}
    if GEMINI_BASE_URL:
        http_options["base_url"] = GEMINI_BASE_URL
    client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=http_options,
    )

    compressed_path = compress_video(video_path, workspace_dir)
    with open(compressed_path, "rb") as f:
        video_bytes = f.read()
    video_part = types.Part.from_bytes(
        data=video_bytes,
        mime_type="video/mp4",
    )

    prompt = """请对这个视频完成以下两项任务，用中文输出：

## 视频概要
简述视频整体内容、时长、类型（录屏/实拍/演示等）。

## 分段内容摘要
按时间段描述视频内容，格式：
- [MM:SS - MM:SS] 内容描述

## 语音转录（带时间戳）
请作为专业速记员，将视频中的全部语音逐字逐句地转录为文本。
不得进行总结或改写，不得省略任何说话片段，保留说话人的原始措辞。

按自然停顿（顿句）逐条记录，每条一个顿句，时间戳精确到毫秒，格式为 MM:SS.mmm：
- [MM:SS.mmm --> MM:SS.mmm] "原话内容（不含标点）"

规则：
- **全量转录**：从头到尾，不得跳过任何说话片段，包括重复、口误、停顿修正
- 每条只含一个顿句（约5-15字），不合并多个顿句
- 保留说话人原话，禁止改写、压缩或润色
- 顿句内容不含标点符号
- 无声或非语音片段直接跳过，不需要标注

示例（原话："今天我们来演示一下，首先点击左上角"）：
- [00:01.200 --> 00:03.500] "今天我们来演示一下"
- [00:03.500 --> 00:05.800] "首先点击左上角"

如果没有语音，说明"无语音"。

## 关键画面
标记有价值的关键画面时间点和描述，适合用作视频封面或钩子。
"""

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_part, prompt],
    )

    # Save analysis to file
    out = Path(workspace_dir) / f"{Path(video_path).stem}_analysis.md"
    out.write_text(response.text, encoding="utf-8")

    return response.text
