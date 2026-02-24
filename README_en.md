# Video Agent — LLM as Director

English | [中文](README.md)

As a lazy person, I'm always looking for shortcuts.
Now that code is all vibecoding, you really expect me to manually edit videos?
That's why this project exists — a video editing agent like Claude Code / Codex, but for video.

Dead simple: drop in a screen recording, say "cut it into a 30-second TikTok," and walk away.

```
>>> Cut that screen recording on the desktop into a 30-second TikTok, use the final result as the opening
```

## How It Works

Not a fixed pipeline of "select clips → fill in parameters → click export."
More like hiring a director — you state your intent, and it figures out the rest.

The Agent uses Gemini to understand the video content, then runs local Whisper to transcribe speech word-by-word with frame-level timestamps (~100ms precision). Finally, it presents an editing plan for your approval before making any cuts.

Changed your mind? Just say so — it'll revise the plan and confirm again. It won't make changes behind your back.

## Why Another Video Editor?

You might ask: with tools like NemoVideo and ChatCut already out there, why build another one?

My answer: **local-first, privacy-first, sky-high ceiling.**

Don't want to upload files to external services? This project is designed for local file access from the ground up.

Don't want to rely on cloud LLMs? You can use local models — just might need to tweak some code.

Most importantly, it's open source. Configure it however you want.

You can even provide an editing style or template in the system prompt, or let the LLM summarize your editing style from each conversation.(good idea, see you in todos)

It also has shell access — the first time I used it, I forgot to specify the working directory, and it found the files I described on its own.

## quicklook

![描述文字](docs/image.png) 
![描述文字](docs/image2.png) 
![描述文字](docs/image4.png) 

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- pnpm
- FFmpeg / ffprobe
- Gemini API Key (get one from [Google AI Studio](https://aistudio.google.com/))

### Installation

```bash
# 1. Install frontend dependencies
pnpm install

# 2. Install backend Python dependencies
cd apps/backend
pip install -e .
```

### Configuration

Copy `apps/backend/.env.example` to `apps/backend/.env` and fill in your Gemini API Key:

```bash
MRDV2_GEMINI_API_KEY=your-key-here
```

Optional configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `MRDV2_GEMINI_BASE_URL` | `""` | Custom API endpoint (proxy/relay) |
| `MRDV2_GEMINI_MODEL` | `gemini-2.5-flash` | Model name（myself using 3.1, anyproblem plz issue ） |
| `MRDV2_WHISPER_MODEL_SIZE` | `medium` | Whisper model size (tiny/small/base/medium/large) |
| `MRDV2_WHISPER_DEVICE` | `auto` | Compute device (auto/cuda/cpu) |

### Run

```bash
# Start both frontend and backend
pnpm dev

# Or run them separately
pnpm dev:frontend   # http://localhost:5173
pnpm dev:backend    # http://localhost:8000
```

Open `http://localhost:5173` in your browser, create a project, and start chatting.

## Features

**Video Understanding** — Gemini multimodal analysis of video content: scene detection, pacing, visual style, text recognition, and editing suggestions

**Speech Transcription** — Local Whisper word-level transcription with ~100ms timestamp precision and automatic language detection

**Smart Editing** — Automatically generates editing plans based on analysis: split, join, speed ramp, arrange — all from a single sentence

**Subtitle Generation** — One-click subtitle track creation from transcription results, auto-aligned to the timeline

**Real-time Preview** — In-browser rendering via Remotion: see changes instantly without exporting

**Plan Confirmation** — The Agent presents its editing plan for your approval before executing. Change your mind anytime

**Shell Access** — Built-in sandboxed shell (ffprobe, mediainfo, etc.) so the Agent can explore media file metadata on its own

**Local File Access** — Direct local filesystem access, no uploads needed

## Roadmap

The project isn't as polished as I'd like yet, but its core is built on Gemini's multimodal capabilities. As LLMs get stronger, many current limitations will naturally resolve.

## TODO

~~A UI that's slightly better than typing in a black terminal~~ (done)

WebGPU + WGSL: color grading

Effects

Personalized editing styles

~~Timeline JSON export to OTIO or FCPXML7~~ (done...maybe? OTIO has no dedicated subtitle support at all — when exporting to DaVinci Resolve and Kdenlive, subtitles were lost, plus all kinds of bizarre bugs. Using a video editor on Linux is truly pain)

See SPEC.md for more details.

## A Note on a Major Architecture Decision

I originally tried to go timeline-free using FFmpeg directly.

After digging deeper, I realized that timelines (and things like ACES color management) are the very foundation that makes editing possible. Going timeline-free was fighting against the grain.

So after researching ChatCut, NemoVideo, and various open-source editing tools, I settled on Remotion + WebGPU for the frontend timeline rendering.
