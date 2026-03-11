1. 字幕brun-in,需求强烈，可以考虑先将原css转换，导出ass后，再给视频硬字幕/内嵌字幕 
2. 多路并发：限制最大并发数 
3. 进度上报：无所谓 
4. 输出格式:优先 h264/MP4
5. 部署：Docker优先，裸机仍然沿用系统ffmpeg,在找不到时报错即可
6. clip 级 volume 不在计划内，amix够用
7. filter_complex 结构，按方案 A：按轨道构建