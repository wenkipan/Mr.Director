Mr.Director：AI Native 剪辑工具

Mr.Director立志使用代码/文件形式描绘剪辑方案，他的剪辑方案可以在任何兼容标准的软件中被二次加工
Mr.Director要做剪辑界的claudecode

多模态混合输入（文字+视频+图片）+自然语言描述如何剪辑-> 剪辑方案


# 传统剪辑方案标准

## NLE-first 
自定义 Timeline JSON Schema，不引入 OTIO 作为运行时数据格式。
OTIO 仅在导出环节使用（Timeline JSON → OTIO → FCPXML7 等行业标准格式）。

- 时间轴、多轨道逻辑（视频轨、音频轨、字幕轨）
- 切割、拼接、变速
- 转场、透明度调节、位置缩放（不在MVP）
- 关键帧，类似于 PR 的基本运动控制（不在MVP）

## 色彩与影像处理标准（不在MVP）
ACES，
OpenColorIO

## 插件开发标准（不在MVP）
OpenFX

# Mr.Director

输出剪辑方案
## ReAct Agent（gemini）

不是workflow而是ReAct Agent

由Agent决定如何分析处理素材，类比 Claude Code，收到"修复这个 bug"后，自己决定读哪个文件、改哪行、跑什么测试。Agent 收到素材+意图后，自己决定先干什么后干什么。所有步骤的顺序和是否执行都是 Agent 自主决策，不是代码硬编码。

## toolcall/MCP
用户交互：询问用户，展现方案
文件系统：列出文件，读取文件，写入文件
gemini： 视频/图像理解，产生分析文件
asr：whisper 分析内容
字幕： 字幕文件生成
shell：兜底操作
导出： Timeline JSON → OTIO → FCPXML7（仅导出时转换）（不在MVP）



# 剪辑效果预览（前端，重点，在浏览器中复刻pr）

剪辑方案在浏览器上的渲染，让人预览


## 技术选型（需确认）

时间线组件：（@xzdarcy/react-timeline-editor？）

remotion：负责管理多轨道、在第几秒显示什么视频、处理帧同步等，直接消费 Timeline JSON

拖拽放入视频（非MVP）
渲染：webgpu+WGSL（非MVP）

获取素材：本地文件或远程文件


## 界面
三栏 UI — 素材 | 视频预览+多轨道时间轴 | Chat Panel，参考 nemovideoui.png


## 一个流程

用户上传素材 + 输入意图
        ↓
Gemini Agent 分析（视频理解 + ASR + 推理）
        ↓
Agent 通过 Tool Calls 生成/修改 Timeline JSON
        ↓
Timeline JSON → WebSocket 推送前端
        ↓
Remotion 渲染预览 + Timeline Editor 展示
        ↓
用户对话调整 → Agent 修改 Timeline JSON → 循环
        ↓（仅导出时）
Timeline JSON → OTIO → FCPXML7 等行业标准格式


