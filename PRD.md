内容编导能力自动化：多模态混合输入（文字+录屏+图片）+自然语言描述你想要将视频做成什么样子→短视频


# Video Agent：LLM as Director


**一句话定位：** 文本文件（文字）+视频文件（录屏/视频）+图片+自然语言交互（eg,以某句话开头，展示代码，展示产品效果,xxx），llm介入分析并确定最终编导效果/流程，最后输出短视频

**目标用户：** 有独特见解但缺乏内容制作经验的创作者。他们不缺想法，缺的是把想法变成专业内容的工作流。

**核心价值：** 让llm提供专业创作者的内容架构建议（选题、钩子、文案、剪辑节奏、平台适配）+自己想要剪辑成什么样，让普通人也能生产结构合理的社交内容。

**核心定位区别：** 不是 Video Workflow，是 Video Agent。
**类比 Claude Code：** Claude Code 收到"修复这个 bug"后，自己决定读哪个文件、改哪行、跑什么测试。Video Agent 收到素材+意图后，自己决定先压缩视频、转录语音、设计编导方案、问用户意见、执行剪辑。所有步骤的顺序和是否执行都是 Agent 自主决策，不是代码硬编码。

## LLM 的编导能力来源

不需要 fine-tune 或海量 few-shot。LLM 训练数据已包含大量相关知识，
只需通过 system prompt 将能力聚焦：定义角色（短视频编导）、定义输出格式（markdown 时间轴）、定义决策框架（分析素材→判断类型→选择策略）。

**难点不在"让 LLM 懂编导"，而在"让编导方案能被准确执行成视频"。**


## Agent 架构

ReAct 驱动的自主 Agent，不是固定 workflow。
Agent 自己决定什么时候该问用户、什么时候该直接执行。

**核心循环：**
```
用户丢素材 + 一句话意图 → Agent 启动 ReAct Loop
                              ↓
                    思考（当前该做什么）
                              ↓
                    调用工具（预处理/剪辑/问用户）
                              ↓
                    观察结果 → 继续思考 → ...
                              ↓
                    用户确认初步剪辑视频可行，输出最终高清剪辑视频
```

**所有能力统一为 Tool Call：**
- 素材预处理（压缩、转录）是 tool
- 剪辑操作（剪切、拼接、加字幕）是 tool
- 用户交互（展示方案、获取反馈）也是 tool


## 视频压缩机制

**压缩迭代 → 高清输出：Agent 重跑 tool call**

迭代阶段在压缩素材上操作（快、省资源）。用户确认最终效果后，Agent 用原始高清素材重新跑一遍同样逻辑的 tool call 序列，输出高清版本。不是系统层自动回放，而是 Agent 自己再执行一轮。


## 编导方案

类比 Claude Code 的 plan 模式：编导方案是给用户看的、用于对齐意图的 markdown 描述。Agent 内部独立决定具体的 tool call 序列。方案和执行是两步独立的 LLM 调用——先生成方案让用户确认，确认后 Agent 自主规划并执行 tool call，不需要从方案文本中"解析"出操作。

用 markdown 人话描述，不用 JSON。示例：
```markdown

**目标平台**: 抖音/TikTok（竖版 9:16，建议30秒内）

### 0-3秒 | 钩子
用你录屏中 1:23 处的最终效果作为开头，配文字"一键生成，不用手动"

### 3-8秒 | 痛点共鸣
你提供的截图1（手动操作的界面），配文字"以前你是不是这样做的？"

### 8-25秒 | 核心演示
录屏的 0:15-0:47 片段，加速到2倍，去掉中间加载等待
自动添加光标聚焦效果，关键步骤处暂停0.5秒加标注

### 25-30秒 | 收尾
回到最终效果画面，配文字"链接在评论区"
```

内容架构视频长短（HOOK → RE-HOOK → VALUE → CTA）不是固定公式，而是 LLM 根据素材类型和用户意图动态决定的。不同内容类型会采用不同结构。



## 工具层

Agent 的所有能力统一为 Tool Call / MCP。工具采用**分层设计**：高层语义工具处理常见操作（快、稳、省 token），底层 Shell 工具兜底复杂场景（灵活、覆盖全）。

类比 Claude Code：Claude Code 有专用工具（Read / Edit / Grep）处理高频操作，同时保留 Bash 工具应对一切长尾场景。Video Agent 同理。

### 工具选择优先级

Agent 在决策时遵循以下优先级：
1. 能用高层语义工具解决 → 用语义工具（快、稳、省 token）
2. 语义工具做不到 → 用 Shell 工具自行组装命令（灵活、覆盖全）
3. 命令行工具做不到 → GUI 自动化
4. GUI 也搞不定 → ask_user 请用户介入

工具可以渐进式增加，每多接一个 MCP / Tool，Agent 就多一项能力。

### 已实现工具

**文件系统工具**
- `list_files` — 列出目录内容（含文件大小）
- `read_file` — 读取文本文件（上限 50KB）
- `write_file` — 写入文件（自动创建目录）

**素材处理工具**
- `compress_video` — 压缩到 720p 短边用于迭代（自适应码率，超 20MB 时动态计算）
- `analyze_video` — Gemini 视觉理解：生成分段摘要 + 逐句语音转录（含毫秒时间戳），保存为 `_analysis.md`
- `get_video_info` — ffprobe 元数据（分辨率、帧率、时长、编码格式）

**剪辑语义工具**
- `cut_video` — 帧精准剪切（re-encode，支持 MM:SS.mmm / HH:MM:SS.mmm / 纯秒数）
- `concat_videos` — 无损拼接（stream copy，concat demuxer）
- `crop_video` — 裁剪画面（支持自动居中，常用于 16:9 → 9:16 竖版）
- `speed_video` — 变速（支持极端倍速，链式 atempo filter）
- `add_subtitles` — 字幕渲染（SRT 输入，自动按标点断句；`[[词语]]` 行内高亮，自动切换 ASS 渲染）
- `add_text_overlay` — 自由位置文字贴片（drawtext，支持 CJK 字体，支持亚秒级出入点）
- `extract_audio` — 提取音频（MP3 / WAV / AAC）

**Shell 工具（兜底）**
- `shell` — 在工作目录内执行任意 FFmpeg / 系统命令（禁用 rm -rf /、sudo、curl、wget、pip；超时 300s）

**用户交互工具**
- `ask_user` — 向用户展示信息并获取反馈（空回车默认"OK 请继续"）

### 待实现工具（后续阶段）

- **图片视觉理解** — Gemini 分析图片素材（截图、产品图）
- **Remotion** — 程序化渲染（动效字幕、转场、数据可视化）
- **ImageMagick** — 图片裁剪、标注、合成
- **GUI 自动化**
  - Anthropic Computer Use — 操作 Descript 精剪、FocuSee 光标聚焦
  - PyAutoGUI MCP — 模拟鼠标键盘操作
  - Browser MCP — 操作 CapCut 网页版、OpusClip 等



## 技术栈

- LLM ReAct 框架：google-genai + Gemini（手动 tool call dispatch，temperature 0.7，max_turns 30）
- 视频处理：FFmpeg / ffprobe（外部依赖）
- CJK 字幕字体：Noto Sans CJK（系统字体）
- 交互：CLI（初期）



## 当前状态

**MVP 已完成。** 单录屏剪辑场景完整可用：

1. 用户提供视频路径 + 一句话意图
2. Agent 自动压缩 → 分析（含语音转录时间戳）→ 出编导方案 → 等待确认 → 执行剪辑
3. 支持多轮修改迭代（压缩版），确认后高清重跑输出最终视频

**关键实现细节（已沉淀进 system prompt）：**
- 时间戳必须取自 `_analysis.md`，禁止估算，防止音画不同步
- 方案变更必须完整重新输出并二次确认，不得直接执行修改
- 编导方案需标注 Take 选择，跳过重录/口误/静默片段
- 字幕自动断句 + `[[高亮]]` 语法，智能选择 SRT / ASS 渲染路径

**下一步重点：**
- 图片素材支持（Gemini 视觉理解截图/产品图）
- 更丰富的字幕/动效（Remotion）
- GUI 自动化集成（Descript、CapCut 等）
