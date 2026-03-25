# TTS 语音合成

文字转语音。输入文字 + 音色，输出音频文件。

## 设计原则

- **通用接口**：不绑定具体 TTS 服务，音色作为参数传入
- **Provider 可切换**：和 LLM/Vision 一样，通过配置切换后端
- **融入现有工作流**：生成的音频自动存到项目媒体目录，可直接添加到 timeline

## 接口定义

```
输入:
  text: str          — 要合成的文字
  voice: str         — 音色 ID（如 "曼波"、"zh-CN-YunxiNeural"）
  speed: float       — 语速倍率，默认 1.0
  output_name: str   — 输出文件名（可选，自动生成）

输出:
  file_path: str     — 生成的音频文件绝对路径
  duration_sec: float — 音频时长
  sample_rate: int   — 采样率
```

## 新增文件

### 1. TTS Provider 抽象 — `services/tts/`

```
apps/backend/app/services/tts/
├── __init__.py          # get_tts_provider() 工厂，按 settings.tts_provider 分发
├── base.py              # TTSProvider 抽象基类
└── edge_provider.py     # edge-tts 实现（免费，开箱即用）
```

#### `base.py` — 抽象接口

```python
class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: str,
        speed: float = 1.0,
        output_path: str,          # 写到哪
    ) -> TTSResult:
        """合成语音，写入 output_path，返回元信息。"""
        ...

    @abstractmethod
    async def list_voices(
        self,
        language: str | None = None,
    ) -> list[VoiceInfo]:
        """列出可用音色，可按语言筛选。"""
        ...

@dataclass
class TTSResult:
    file_path: str
    duration_sec: float
    sample_rate: int

@dataclass
class VoiceInfo:
    id: str            # 传给 synthesize 的 voice 参数
    name: str          # 人类可读名
    language: str      # zh-CN, en-US, ...
    gender: str        # male / female
```

#### `edge_provider.py` — 默认实现

- 依赖 `edge-tts`（pip install edge-tts），零 API key
- `synthesize()`: 调用 edge-tts 生成 mp3，ffmpeg 转 wav（可选）
- `list_voices()`: 调用 `edge_tts.list_voices()` 返回可用列表
- 覆盖中文、英文、日文等主流语言的几十种音色

后续可加：`openai_provider.py`（OpenAI TTS API）、`fish_provider.py`（Fish Audio 声音克隆）等。

### 2. Agent 工具 — `tools/tts.py`

两个工具：

#### `generate_speech` — 核心合成工具

```python
@registry.register(
    name="generate_speech",
    description="Text-to-speech: synthesize text into an audio file with a specified voice.",
    parameters={
        "type": "OBJECT",
        "properties": {
            "text":        {"type": "STRING", "description": "Text to synthesize"},
            "voice":       {"type": "STRING", "description": "Voice ID (from list_voices)"},
            "speed":       {"type": "NUMBER", "description": "Speed multiplier, default 1.0"},
            "output_name": {"type": "STRING", "description": "Output filename (optional)"},
        },
        "required": ["text", "voice"],
    },
)
```

逻辑：
1. 调用 `tts_provider.synthesize(text, voice, speed, output_path)`
2. 音频文件保存到 `state.media_dir/tts_<timestamp>.mp3`
3. 返回 `{ file_path, duration_sec, sample_rate }`
4. Agent 后续可用 `manage_timeline add_media` + `add_clips` 将音频放到 timeline

#### `list_voices` — 查询可用音色

```python
@registry.register(
    name="list_voices",
    description="List available TTS voices, optionally filtered by language.",
    parameters={
        "type": "OBJECT",
        "properties": {
            "language": {"type": "STRING", "description": "Filter by language code, e.g. 'zh', 'en'"},
        },
        "required": [],
    },
)
```

### 3. 配置 — `config.py` 新增字段

```python
# TTS
tts_provider: str = "edge"       # edge / openai / fish
tts_api_key: str = ""            # 部分 provider 需要
tts_base_url: str = ""           # 自定义端点
tts_default_voice: str = ""      # 默认音色，空 = 由 provider 决定
```

环境变量：`MRDV2_TTS_PROVIDER`、`MRDV2_TTS_API_KEY`、`MRDV2_TTS_BASE_URL`、`MRDV2_TTS_DEFAULT_VOICE`

### 4. 注册入口 — `agent/loop.py`

```python
import app.tools.tts  # noqa: F401
```

## Agent 使用流程示例

```
用户: "用曼波的声音给这段视频配一段旁白：今天天气真好"

Agent:
1. list_voices(language="zh")        → 找到 voice_id
2. generate_speech(text="今天天气真好", voice="manbo")
   → { file_path: "/media/tts_20260321_143000.mp3", duration_sec: 2.1 }
3. manage_timeline(operations=[{op: "add_media", ...}])
4. add_clips(clips=[{ media_id: "...", track_id: "audio-1", ... }])
```

## 依赖

| 包 | 用途 | 必需? |
|----|------|-------|
| `edge-tts` | Edge TTS provider | P0 默认 |
| `openai` | OpenAI TTS provider | 可选 |

## 实现顺序

1. `services/tts/base.py` — 抽象接口
2. `services/tts/edge_provider.py` — Edge-TTS 实现
3. `services/tts/__init__.py` — 工厂函数
4. `config.py` — 新增 TTS 配置字段
5. `tools/tts.py` — `generate_speech` + `list_voices` 工具
6. `agent/loop.py` — 注册导入
