# Video Agent — LLM as Director

English | [中文](README.md)

I'm lazy. I've always been lazy.
Coding is already vibecoding. You really think I'm going to sit there and manually edit videos?
That's why this exists — a video editing agent, like Claude Code or Codex, but for your footage.

Drop in a screen recording, say "make this a 30-second TikTok", and go touch grass.

```
>>> turn that screen recording on my desktop into a 30-second TikTok, start with the final result
```

## How it works

Not a "select clip → fill in params → click export" pipeline.
More like hiring a director — you give the intent, it figures out the rest.

The agent feeds your video to Gemini to understand the footage, then runs it through local Whisper to get word-level timestamps accurate to ~100ms. Then it writes up an editing plan and waits for your OK before touching anything.

Changed your mind? Just say so. It'll rewrite the plan and ask again. It won't sneak in edits without confirmation.

## Getting started

You'll need:
- Python 3.11+
- `ffmpeg` / `ffprobe`
- `Noto Sans CJK` font (for CJK text overlays)

```bash
python3 -m venv .venv
source .venv/bin/activate

pip install -e .
cp .env.example .env
# fill in your GEMINI_API_KEY
```

Then:

```bash
videoagent                    # start in current directory
videoagent /path/to/project   # specify workspace
```

Just describe what you want in natural language. `/quit` to exit.

## Config

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Gemini API key | required |
| `GEMINI_MODEL` | Model name | `gemini-3.1-pro-high` |
| `GEMINI_BASE_URL` | API proxy URL | — |
| `COMPRESS_SHORT_SIDE` | Short side resolution for compression | `720` |
| `COMPRESS_BITRATE` | Video bitrate for compression | `1M` |
| `WHISPER_MODEL` | Whisper model size | `medium` |
| `WHISPER_DEVICE` | Inference device | `cpu` (use `cuda` if available) |
| `WORKSPACE_DIR` | Workspace directory | `workspace/` next to input file |

## What it can do

Cut, concat, crop to vertical, speed up, add subtitles, overlay text, extract audio — all the common stuff has dedicated tools. Anything beyond that falls back to raw FFmpeg commands. There's basically nothing it can't handle.

Subtitles support `[[highlight]]` syntax to render specific words in a different color.

## Roadmap

The project isn't as capable as I'd like yet. But the whole thing is built on Gemini's multimodal abilities — and as models get stronger, a lot of the current rough edges will just... go away on their own.

Still on the list:
- A UI that isn't a black terminal window
- Visual effects
- Transitions
