是否考虑先支持webgpu+wgsl，再考虑增加色彩校正？


增加色彩校正特性：

色温色调

曝光度 

对比度

饱和度

以及色轮三件套LGG

Lift

Gamma

Gain


1. 先做agent和浏览器双端通信标准

 json中如何体现


扩展 VideoStyle，新增 color_correction



2. agent操控： 
继续用 edit_clips tool 的 update 操作，无需独立接口。

当前 edit_clips 的 _exec_update 已经支持 video_style 字段直接 setattr

1. 前端：

在 VideoClipEditor 中加 tab 切换，分 3 个标签：

Tab	    内容
Basic	Position, Size, Appearance（现有内容）
Color	Exposure, Contrast, Saturation, Temperature, Tint
LGG	Lift (R/G/B), Gamma (R/G/B), Gain (R/G/B)
