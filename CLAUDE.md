# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MrDV2 (Mr.Director V2) is an AI-native video editing tool. The core abstraction是 Timeline JSON——一个平台无关的剪辑描述，由 Remotion 在浏览器中渲染，可导出为 FCPXML/OTIO。

**产品定位**：Timeline 是人和 Agent 共享的工作空间，而非一次性粗剪产物。Agent（Gemini-powered ReAct）通过工具操作 timeline 实现剪辑效果，用户也可以在 UI 上手动编辑同一条 timeline。这种抽象建模使人-Agent 协同成为可能——Agent 不是一锤子买卖的粗剪工具，而是持续参与编辑过程的协作者。设计决策应始终围绕"让人和 Agent 都能高效读写同一个 timeline"展开。

## Monorepo Structure

pnpm workspaces with three packages:

- **`apps/backend`** — FastAPI + Python: ReAct agent, tool execution, Gemini API, Whisper ASR
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
2. Agent calls Gemini with function calling, executes tools (may modify timeline)
3. Timeline changes saved to `projects/{project_id}.json` and broadcast via WebSocket (`/ws/timeline`)
4. Frontend receives WebSocket update → Zustand store → Remotion player + TimelineEditor re-render

### Backend Agent System (`apps/backend/app/`)

- **`agent/loop.py`** — ReAct loop: calls Gemini, dispatches tool calls, max 20 iterations
- **`agent/state.py`** — Per-project `AgentState` (conversation history, current timeline, media dir)
- **`tools/registry.py`** — Decorator-based tool registration, converts to Gemini function declarations
- **Tool modules** (`tools/`): `timeline_ops`, `filesystem`, `gemini_vision`, `asr`, `subtitles`, `shell`, `user_interaction`
- **`services/gemini_client.py`** — Singleton Gemini client with optional custom base URL
- **`services/ws_manager.py`** — WebSocket connection manager for timeline broadcasts
- **`models/`** — Pydantic models for Timeline, Clips, Tracks, MediaAsset, Chat messages

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
| `/ws/timeline` | WS | Real-time timeline updates (query: project_id) |

## Configuration

Backend env vars (prefix `MRDV2_`, loaded from `apps/backend/.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MRDV2_GEMINI_API_KEY` | `""` | Gemini API key (required) |
| `MRDV2_GEMINI_BASE_URL` | `""` | Custom API endpoint (optional, for proxies) |
| `MRDV2_GEMINI_MODEL` | `gemini-2.5-flash` | Model name |
| `MRDV2_WHISPER_MODEL_SIZE` | `medium` | Whisper ASR model size |
| `MRDV2_WHISPER_DEVICE` | `auto` | Whisper device (auto/cuda/cpu) |
| `MRDV2_PROJECTS_DIR` | `./projects` | Timeline JSON storage directory |

## Conventions

- 在发现更好的实现时要反驳用户，必要时质疑新的需求是否有必要存在
- Python: snake_case files and variables
- TypeScript: PascalCase components (`ChatPanel.tsx`), camelCase for hooks/utils
- Tool registration uses `@registry.register()` decorator pattern
- Pydantic models for all API request/response shapes
- Config via `pydantic_settings.BaseSettings` with `MRDV2_` env prefix
