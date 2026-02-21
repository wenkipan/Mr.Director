导出为 FCPXML 格式

## 实现顺序

FCPXML 1.9 ，使用 Python 标准库 xml.etree.ElementTree 手写 FCPXML/EDL

## 预期用途是

"能在 FCP 里继续编辑"
## 效果

在llm生成预览效果或者最终高清视频的时候，同时生成一份fcpxml

## 问题

如果一个视频过长，llm将他切割成了多个片段，生成的fcpxml对应的是？

字幕，overlap的处理？

源文件引用问题：FCPXML要求实际媒体文件，而现有流程在压缩版上迭代
