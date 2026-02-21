from video_agent.tools.analyze import analyze_video
from video_agent.tools.audio import extract_audio
from video_agent.tools.transcribe import transcribe_audio
from video_agent.tools.concat import concat_videos
from video_agent.tools.crop import crop_video
from video_agent.tools.cut import cut_video
from video_agent.tools.files import list_files, read_file, write_file
from video_agent.tools.info import get_video_info
from video_agent.tools.overlay import add_text_overlay
from video_agent.tools.shell import shell
from video_agent.tools.speed import speed_video
from video_agent.tools.subtitles import add_subtitles
from video_agent.tools.tts import tts

# name -> callable
TOOLS = {
    "get_video_info": get_video_info,
    "analyze_video": analyze_video,
    "cut_video": cut_video,
    "concat_videos": concat_videos,
    "crop_video": crop_video,
    "speed_video": speed_video,
    "add_subtitles": add_subtitles,
    "add_text_overlay": add_text_overlay,
    "extract_audio": extract_audio,
    "transcribe_audio": transcribe_audio,
    "tts": tts,
    "shell": shell,
    "read_file": read_file,
    "write_file": write_file,
    "list_files": list_files,
}

# For passing to genai config
TOOL_FUNCTIONS = list(TOOLS.values())
