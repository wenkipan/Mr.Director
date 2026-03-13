# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MrDV2 (Mr.Director V2) is an AI-native video editing tool. The core abstraction是 Timeline JSON——一个平台无关的剪辑描述，由 Remotion 在浏览器中渲染，可导出为 MP4/FCPXML/OTIO/SRT/ASS。

**产品定位**：Timeline 是人和 Agent 共享的工作空间，而非一次性粗剪产物。Agent（ReAct loop，支持 Gemini / OpenAI 兼容 API）通过工具操作 timeline 实现剪辑效果，用户也可以在 UI 上手动编辑同一条 timeline。设计决策应始终围绕"让人和 Agent 都能高效读写同一个 timeline"展开。

## Monorepo Structure

pnpm workspaces with three packages:

- **`apps/backend`** — FastAPI + Python: ReAct agent, tool execution, LLM providers (Gemini/OpenAI), Whisper ASR, export pipeline
- **`apps/frontend`** — React + TypeScript + Vite: 3-panel UI (media browser, Remotion player + timeline editor, chat)
- **`packages/shared`** — Timeline JSON Schema (source of truth) + auto-generated TypeScript types

## Common Commands

```bash
# Install all dependencies
pnpm install

# Run both frontend (port 5173) and backend (port 8000) in parallel
pnpm dev

# Run individually
pnpm dev:frontend          # Vite dev server
pnpm dev:backend           # uvicorn with --reload

# Build all packages
pnpm build

# Regenerate TypeScript types from timeline.schema.json
pnpm generate:types

# Backend: install Python deps (from apps/backend/)
pip install -e .

# Backend: run directly
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

No test or lint commands are configured yet.

## Architecture

### Data Flow

1. User sends chat message → `POST /api/chat` → ReAct Agent loop
2. Agent calls LLM (Gemini or OpenAI, based on `MRDV2_LLM_PROVIDER`) with function calling, executes tools (may modify timeline)
3. Timeline changes saved to `projects/{project_id}.json` and broadcast via WebSocket (`/ws/timeline`)
4. Frontend receives WebSocket update → Zustand store → Remotion player + TimelineEditor re-render

### Backend Agent System (`apps/backend/app/`)

**LLM Provider Abstraction** (`services/llm/`):
- `base.py` — Abstract `LLMProvider` / `LLMResponse` / `ToolCall` interfaces
- `gemini_provider.py` / `openai_provider.py` — Provider implementations
- `__init__.py` — `get_provider()` singleton factory, dispatches on `settings.llm_provider`

**Agent Core**:
- `agent/loop.py` — Provider-agnostic ReAct loop: calls LLM, dispatches tool calls, max 20 iterations
- `agent/state.py` — Per-project `AgentState` (conversation history, current timeline, media dir)
- `agent/prompt.py` — System prompt builder

**Tool System** (`tools/`):
- `registry.py` — Decorator-based `@registry.register()`, parameters use Gemini uppercase types (`"STRING"`, `"OBJECT"`), auto-normalized for OpenAI
- Tool modules: `timeline_ops`, `filesystem`, `shell`, `vision`, `asr`, `subtitles`, `time_mapping`, `user_interaction`, `export`

**Vision Tools** (`tools/vision.py`):
- Dispatches to Gemini or OpenAI based on `MRDV2_VISION_PROVIDER` (independent of agent LLM provider)
- Gemini path: Files API upload or inline bytes (proxy mode)
- OpenAI path: `/v1/files` upload or base64 inline (proxy mode), via `services/openai_vision.py`
- Video is compressed to 720p before sending (`services/video_compress.py`)
- Results persisted to `<filename>_analysis.md` (`services/analysis_file.py`)

**Export Pipeline** (`services/`):
- `export_jobs.py` — Async job tracking with status polling
- `ffmpeg_export.py` — FFmpeg-based MP4 export
- `remotion_export.py` — Browser-based Remotion render
- Format exports: `fcpxml_export.py`, `otio_export.py`, `srt_export.py`, `ass_export.py`

**Key Services**:
- `timeline_manager.py` — Per-project timeline state, save + WebSocket broadcast
- `gemini_client.py` — Singleton Gemini client (used by vision tools when provider=gemini)
- `ws_manager.py` — WebSocket connection manager

### Frontend (`apps/frontend/src/`)

- **`App.tsx`** — 3-panel resizable layout (MediaPanel | CenterPanel | ChatPanel)
- **`stores/appStore.ts`** — Zustand store: timeline state, playback, chat messages, WebSocket status
- **`remotion/TimelineComposition.tsx`** — Remotion composition that renders Timeline JSON to video
- **`hooks/useWebSocket.ts`** — WebSocket connection for real-time timeline updates
- **`lib/api.ts`** — REST API client
- Vite proxy: `/api/*` → `http://localhost:8000`, `/ws/*` → `ws://localhost:8000`

### Timeline JSON Schema

Defined in `packages/shared/schemas/timeline.schema.json`. Key rules:
- All times in **seconds** (float)
- `timeline_end_sec = timeline_start_sec + (source_out_sec - source_in_sec) / speed` (auto-computed for media clips)
- Media must exist in `media_pool` before being referenced in clips
- Clips cannot overlap on the same track
- Track types: `video`, `audio`, `subtitle`

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Send message to agent, returns response |
| `/api/projects` | POST | Create project (returns project_id + empty timeline) |
| `/api/projects/{id}` | GET | Get project timeline |
| `/api/projects/{id}/timeline` | PUT | Update project timeline |
| `/api/media/list` | GET | List media files |
| `/api/media/file` | GET | Serve media file (HTTP Range) |
| `/api/export` | POST | Start export job (MP4/FCPXML/OTIO) |
| `/api/export/{id}/status` | GET | Poll export job status |
| `/api/export/{id}/download` | GET | Download exported file |
| `/api/export/{id}/srt` | GET | Download SRT subtitles |
| `/api/export/gpu-status` | GET | Check GPU availability for export |
| `/ws/timeline` | WS | Real-time timeline updates (query: project_id) |

## Configuration

Backend env vars (prefix `MRDV2_`, loaded from `apps/backend/.env`). See `.env.example` for full list.

**LLM Provider** (agent reasoning):

| Variable | Default | Description |
|----------|---------|-------------|
| `MRDV2_LLM_PROVIDER` | `gemini` | `gemini` or `openai` |
| `MRDV2_GEMINI_API_KEY` | `""` | Gemini API key |
| `MRDV2_GEMINI_BASE_URL` | `""` | Custom endpoint (proxy mode) |
| `MRDV2_GEMINI_MODEL` | `gemini-2.5-flash` | Model name |
| `MRDV2_OPENAI_API_KEY` | `""` | OpenAI-compatible API key |
| `MRDV2_OPENAI_BASE_URL` | `""` | Custom endpoint (DeepSeek/Qwen/etc.) |
| `MRDV2_OPENAI_MODEL` | `gpt-4o` | Model name |
| `MRDV2_OPENAI_THINKING` | `off` | `off` / `dashscope` / `deepseek` |

**Vision Provider** (video/image understanding, independent of agent LLM):

| Variable | Default | Description |
|----------|---------|-------------|
| `MRDV2_VISION_PROVIDER` | `gemini` | `gemini` or `openai` |
| `MRDV2_VISION_API_KEY` | `""` | Empty = fallback to matching provider's key |
| `MRDV2_VISION_BASE_URL` | `""` | Empty = fallback to matching provider's base_url |
| `MRDV2_VISION_MODEL` | `""` | Empty = fallback to matching provider's model |

## Conventions

- 在发现更好的实现时要反驳用户，必要时质疑新的需求是否有必要存在
- Python: snake_case files and variables
- TypeScript: PascalCase components (`ChatPanel.tsx`), camelCase for hooks/utils
- Tool registration uses `@registry.register()` decorator pattern; parameters use Gemini uppercase types (`"STRING"`, `"OBJECT"`)
- Pydantic models for all API request/response shapes
- Config via `pydantic_settings.BaseSettings` with `MRDV2_` env prefix
