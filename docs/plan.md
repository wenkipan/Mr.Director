# Plan: 添加 `get_timeline` 工具

## 背景

LLM 在 ReAct loop 中只能从 system prompt 的摘要看到 timeline 的粗略信息（clip ID + 时间范围），缺少 `source_in_sec`、`speed`、`video_style` 等关键字段。需要一个工具让 LLM 能主动获取完整 timeline JSON。

## 改动

### 1. 在 `apps/backend/app/tools/timeline_ops.py` 中新增 `get_timeline` 工具

使用 `@registry.register()` 注册，无需参数。逻辑：
- 从 `state.current_timeline` 读取当前 timeline
- 如果不存在，返回 `{"error": "No timeline exists..."}`
- 返回 `{"project_id": state.project_id, "timeline": state.current_timeline.model_dump()}`

这样 LLM 就能拿到完整的 JSON，包括所有 clip 的详细属性。

### 2. 在 `apps/backend/app/agent/prompt.py` 的 system prompt 中补充信息

两处改动：
- 在 `## Current Timeline State` 部分加入 `project_id`，让 LLM 明确知道自己操作的是哪个项目
- 在 `## Your Capabilities` 部分提示 LLM：可以用 `get_timeline` 获取完整 timeline JSON（system prompt 中的摘要不含所有字段）

## 不需要改动的地方

- `loop.py`：`get_timeline` 是只读操作，不在 `TIMELINE_MODIFYING_TOOLS` 中，不需要触发 WebSocket 广播或磁盘保存。`timeline_ops.py` 已经被 import，新工具会自动注册。
- `state.py`：不需要改动
- `registry.py`：不需要改动
