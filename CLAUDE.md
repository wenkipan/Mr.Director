# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LLM as Director** — A ReAct-based AI agent for video editing. The user provides media and intent in natural language; the agent analyzes, proposes an editing plan, waits for confirmation, then executes via tools.

## Setup & Running

```bash
python3 -m venv .venv
source .venv/bin/activate

# Install in dev mode (all Python deps including faster-whisper)
pip install -e .

# Configure environment
cp .env.example .env
# Fill in GEMINI_API_KEY and GEMINI_MODEL

# Run
videoagent
# or
python main.py
```

**External dependencies (must be installed on system):**
- `ffmpeg` and `ffprobe` — all video processing
- `Noto Sans CJK` font — CJK text overlay

## Architecture

```
main.py (entry-point shim → video_agent/cli.py)
  └── video_agent/cli.py (CLI loop)
        └── video_agent.Agent (ReAct loop, stateful across turns)
              ├── Gemini API (vision + tool calling, manual mode)
              ├── faster-whisper (local ASR, frame-accurate timestamps)
              ├── video_agent/prompts.py (Chinese-language system prompt)
              ├── video_agent/config.py (env vars)
              └── video_agent/tools/ (14 tools registered in tools/__init__.py)
```

**ReAct loop** (`agent.py`): Each `.run(user_message)` call appends to persistent conversation history, sends to Gemini, manually dispatches tool calls, feeds results back, and repeats up to `max_turns=30`.

**Tool registration**: All tools are registered in `tools/__init__.py` as a `TOOLS` dict (name → callable) and a `TOOL_FUNCTIONS` list (passed to Gemini config).

## Key Architectural Decisions

**Transparent compression**: `analyze_video` internally compresses the input video before uploading to Gemini (to reduce upload size). This is invisible to the LLM — the agent passes the original video path directly to `analyze_video`. All editing tools (`cut_video`, `concat_videos`, etc.) operate on the original video from the start.

**Dual-pass analysis**: `analyze_video` (Gemini vision) handles scene understanding; `transcribe_audio` (local Whisper via `faster-whisper`) replaces the speech transcription section in the same `_analysis.md` file with frame-accurate timestamps (~100ms vs Gemini's ~1s). The agent always calls both in sequence before editing.

**Timestamp accuracy**: The agent must read the `_analysis.md` file to extract exact speech timestamps — never estimate. The Whisper-generated timestamps in `MM:SS.mmm` format are authoritative for all `cut_video` calls.

**Plan confirmation gate**: The system prompt requires the agent to present a markdown editing plan and call `ask_user` to get explicit confirmation before executing any edits.

**Manual tool calling**: `automatic_function_calling` is disabled on the Gemini client. The agent loop in `agent.py` manually parses and dispatches `FunctionCall` parts, giving precise control over execution and output display.

**Subtitle rendering path**: `subtitles.py` auto-detects whether inline `[[word]]` highlights are present. Without highlights it uses SRT + `force_style`; with highlights it converts to ASS format for per-word coloring.

## Tool Summary

| Tool | File | Purpose |
|------|------|---------|
| `analyze_video` | analyze.py | Gemini vision analysis → `_analysis.md` (scene summary, key frames); internally compresses video before upload |
| `transcribe_audio` | transcribe.py | Whisper ASR → replaces speech section in `_analysis.md` with ~100ms timestamps |
| `cut_video` | cut.py | Frame-accurate trim (re-encodes) |
| `concat_videos` | concat.py | Stream-copy concatenation |
| `crop_video` | crop.py | Crop (e.g. 16:9 → 9:16) |
| `speed_video` | speed.py | Playback speed adjustment |
| `add_subtitles` | subtitles.py | SRT/ASS subtitles with `[[highlight]]` |
| `add_text_overlay` | overlay.py | Free-positioned drawtext overlay |
| `extract_audio` | audio.py | Audio extraction (MP3/WAV/AAC) |
| `get_video_info` | info.py | ffprobe metadata as JSON |
| `read_file` / `write_file` / `list_files` | files.py | Workspace file I/O |
| `shell` | shell.py | Arbitrary FFmpeg commands (fallback) |
| `ask_user` | user.py | User confirmation / feedback |

## Configuration (`config.py`)

All config is loaded from `.env`:
- `GEMINI_API_KEY`, `GEMINI_MODEL` (default: `gemini-3-flash-preview`), `GEMINI_BASE_URL` (optional proxy)
- `COMPRESS_SHORT_SIDE` (default: 720), `COMPRESS_BITRATE` (default: `1M`), `COMPRESS_MAX_SIZE_MB` (default: 20)
- `WHISPER_MODEL` (default: `medium`), `WHISPER_DEVICE` (default: `cpu`) — faster-whisper inference settings
- `WORKSPACE_DIR` (default: `./workspace` relative to input file)

## System Prompt Language

`prompts.py` is written in Chinese. The agent is designed for Chinese-speaking users producing short-form vertical video (Douyin/TikTok style).

## Documentation Maintenance

The project maintains two README versions:
- `README.md` — Chinese (primary)
- `README_en.md` — English

**Rule**: Whenever `README.md` is updated, all other language versions must be updated in the same change to stay in sync.
