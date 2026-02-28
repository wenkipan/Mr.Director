export interface ProjectMeta {
  name: string;
  width: number;
  height: number;
  fps: 23.976 | 24 | 25 | 29.97 | 30 | 50 | 59.94 | 60;
}

export interface MediaAsset {
  id: string;
  path: string;
  type: 'video' | 'audio' | 'image';
  duration_sec?: number;
  width?: number;
  height?: number;
  sample_rate?: number;
  channels?: number;
}

export interface SubtitleStyle {
  position_x?: number;
  position_y?: number;
  font_family?: string;
  font_size?: number;
  color?: string;
  background?: string;
  text_align?: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
}

export interface VideoStyle {
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  fit?: 'contain' | 'cover' | 'fill';
  crop_left?: number;
  crop_top?: number;
  crop_right?: number;
  crop_bottom?: number;
  border_radius?: number;
}

export interface Clip {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  media_id?: string;
  source_in_sec?: number;
  source_out_sec?: number;
  timeline_start_sec: number;
  duration_sec: number;
  speed?: number;
  subtitle_text?: string;
  subtitle_style?: SubtitleStyle;
  video_style?: VideoStyle;
}

export interface Track {
  id: string;
  name?: string;
  type: 'video' | 'audio' | 'subtitle';
  locked?: boolean;
  muted?: boolean;
  clips: Clip[];
}

export interface TimelineProject {
  version: '1.0.0';
  project: ProjectMeta;
  media_pool: MediaAsset[];
  tracks: Track[];
}
