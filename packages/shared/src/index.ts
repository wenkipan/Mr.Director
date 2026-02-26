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
  font_family?: string;
  font_size?: number;
  color?: string;
  background?: string;
  position_y?: number;
}

export interface TextStyle {
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

export interface Clip {
  id: string;
  type: 'video' | 'audio' | 'subtitle' | 'text';
  media_id?: string;
  source_in_sec?: number;
  source_out_sec?: number;
  timeline_start_sec: number;
  duration_sec: number;
  speed?: number;
  subtitle_text?: string;
  subtitle_style?: SubtitleStyle;
  text_content?: string;
  text_style?: TextStyle;
}

export interface Track {
  id: string;
  name?: string;
  type: 'video' | 'audio' | 'subtitle' | 'text';
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
