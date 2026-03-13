from __future__ import annotations

from pydantic import BaseModel, Field


class SubtitleStyle(BaseModel):
    """Subtitle style properties.

    All fields are Optional so the same model works for both:
    - Preset definitions (all fields set, stored in styles/*.json)
    - Per-clip overrides (only overridden fields set, stored on Clip)
    """

    position_x: float | None = None
    position_y: float | None = None
    font_family: str | None = None
    font_size: int | None = None
    color: str | None = None
    background: str | None = None
    text_align: str | None = None  # "left" | "center" | "right"
    bold: bool | None = None
    italic: bool | None = None
    # Extended style properties
    outline_color: str | None = None
    outline_width: float | None = None
    shadow: str | None = None  # CSS text-shadow value
    padding: str | None = None  # CSS padding value
    border_radius: float | None = None
    opacity: float | None = None
    letter_spacing: float | None = None


DEFAULT_SUBTITLE_STYLE = SubtitleStyle(
    position_x=0.5,
    position_y=0.85,
    font_family="sans-serif",
    font_size=48,
    color="#FFFFFF",
    background="rgba(0,0,0,0.6)",
    text_align="center",
    bold=False,
    italic=False,
    outline_color="transparent",
    outline_width=0,
    shadow="none",
    padding="4px 16px",
    border_radius=4,
    opacity=1.0,
    letter_spacing=0,
)


def resolve_subtitle_style(
    preset: SubtitleStyle, override: SubtitleStyle | None = None
) -> SubtitleStyle:
    """Merge preset base with per-clip overrides. Non-None override fields win."""
    base = preset.model_dump()
    if override:
        for key, value in override.model_dump(exclude_none=True).items():
            base[key] = value
    return SubtitleStyle(**base)


class VideoStyle(BaseModel):
    position_x: float = 0.5
    position_y: float = 0.5
    width: float = 1.0
    height: float = 1.0
    opacity: float = 1.0
    fit: str = "contain"  # "contain" | "cover" | "fill"
    crop_left: float = 0
    crop_top: float = 0
    crop_right: float = 0
    crop_bottom: float = 0
    border_radius: float = 0


class Clip(BaseModel):
    id: str
    type: str  # "video" | "audio" | "subtitle"
    media_id: str | None = None
    source_in_sec: float = 0
    source_out_sec: float | None = None
    timeline_start_sec: float
    timeline_end_sec: float
    speed: float = 1.0
    subtitle_text: str | None = None
    subtitle_style_ref: str | None = None  # preset name, e.g. "default"
    subtitle_style: SubtitleStyle | None = None  # per-clip overrides
    video_style: VideoStyle | None = None


class Track(BaseModel):
    id: str
    name: str | None = None
    type: str  # "video" | "audio" | "subtitle"
    locked: bool = False
    muted: bool = False
    clips: list[Clip] = []


class MediaAsset(BaseModel):
    id: str
    path: str
    type: str  # "video" | "audio" | "image"
    duration_sec: float | None = None
    width: int | None = None
    height: int | None = None
    sample_rate: int | None = None
    channels: int | None = None


class ProjectMeta(BaseModel):
    name: str
    width: int = 1920
    height: int = 1080
    fps: float = 30


class TimelineProject(BaseModel):
    version: str = "1.0.0"
    project: ProjectMeta
    media_pool: list[MediaAsset] = []
    tracks: list[Track] = []


def migrate_project_data(data: dict) -> dict:
    """Migrate legacy project JSON: convert text tracks/clips → subtitle."""
    for track in data.get("tracks", []):
        if track.get("type") == "text":
            track["type"] = "subtitle"
        for clip in track.get("clips", []):
            if clip.get("type") == "text":
                clip["type"] = "subtitle"
            # Migrate duration_sec → timeline_end_sec
            if "duration_sec" in clip and "timeline_end_sec" not in clip:
                clip["timeline_end_sec"] = clip["timeline_start_sec"] + clip["duration_sec"]
                del clip["duration_sec"]
            # Move text_content → subtitle_text
            if clip.get("text_content") and not clip.get("subtitle_text"):
                clip["subtitle_text"] = clip.pop("text_content")
            else:
                clip.pop("text_content", None)
            # Move text_style → subtitle_style
            if clip.get("text_style") and not clip.get("subtitle_style"):
                clip["subtitle_style"] = clip.pop("text_style")
            else:
                clip.pop("text_style", None)
    return data
