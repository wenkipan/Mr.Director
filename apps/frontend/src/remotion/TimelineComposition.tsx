import { AbsoluteFill, Sequence, Video, OffthreadVideo, Audio, Img, useVideoConfig, useCurrentFrame } from 'remotion';
import type { TimelineProject, Clip as ClipType, VideoStyle, SubtitleStyle } from '@mrdv2/shared';
import { resolveSubtitleStyle, DEFAULT_SUBTITLE_STYLE } from '@mrdv2/shared';
import { resolveMediaUrl, getMediaType } from '../lib/timelineAdapter';
import { parseSrt, type SrtEntry } from '../lib/srtParser';
import { useEffect, useState } from 'react';
import { EditableText } from './EditableText';
import { useAppStore } from '../stores/appStore';

/** Build CSS properties from a fully resolved SubtitleStyle. */
function subtitleStyleToCss(s: Required<SubtitleStyle>): React.CSSProperties {
  const bg = s.background;
  const hasBg = bg && bg !== 'transparent';
  return {
    position: 'absolute',
    left: `${(s.position_x * 100).toFixed(1)}%`,
    top: `${(s.position_y * 100).toFixed(1)}%`,
    transform: 'translate(-50%, -50%)',
    fontFamily: s.font_family,
    fontSize: s.font_size,
    color: s.color,
    backgroundColor: bg,
    textAlign: s.text_align as React.CSSProperties['textAlign'],
    fontWeight: s.bold ? 'bold' : 'normal',
    fontStyle: s.italic ? 'italic' : 'normal',
    padding: hasBg ? s.padding : undefined,
    borderRadius: hasBg ? s.border_radius : undefined,
    maxWidth: '80%',
    whiteSpace: 'pre-wrap',
    opacity: s.opacity,
    letterSpacing: s.letter_spacing !== 0 ? s.letter_spacing : undefined,
    WebkitTextStroke: s.outline_width > 0 ? `${s.outline_width}px ${s.outline_color}` : undefined,
    textShadow: s.shadow !== 'none' ? s.shadow : undefined,
  };
}

/** Resolve a clip's subtitle style using presets from the store. */
function useResolvedStyle(clip: ClipType): Required<SubtitleStyle> {
  const presets = useAppStore((s) => s.subtitlePresets);
  const presetName = clip.subtitle_style_ref ?? 'default';
  const preset = presets[presetName] ?? DEFAULT_SUBTITLE_STYLE;
  return resolveSubtitleStyle(preset, clip.subtitle_style);
}

/** Renders a single SRT-backed subtitle clip, fetching & parsing the .srt file.
 *  In SSR mode, clip._srt_content is pre-populated by the backend so no fetch is needed. */
const SrtSubtitleClip: React.FC<{
  clip: ClipType;
  timeline: TimelineProject;
  fps: number;
}> = ({ clip, timeline, fps }) => {
  const frame = useCurrentFrame();
  const resolved = useResolvedStyle(clip);
  const [entries, setEntries] = useState<SrtEntry[]>([]);

  const inlineSrt = (clip as any)._srt_content as string | undefined;
  const mediaUrl = clip.media_id ? resolveMediaUrl(clip.media_id, timeline) : '';

  useEffect(() => {
    if (inlineSrt) {
      setEntries(parseSrt(inlineSrt));
      return;
    }
    if (!mediaUrl) return;
    fetch(mediaUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch SRT: ${r.status}`);
        return r.text();
      })
      .then((text) => setEntries(parseSrt(text)))
      .catch((err) => console.warn('SRT fetch error:', err));
  }, [mediaUrl, inlineSrt]);

  const sourceTime = (clip.source_in_sec ?? 0) + (frame / fps) * (clip.speed ?? 1);
  const active = entries.find((e) => sourceTime >= e.startSec && sourceTime < e.endSec);
  if (!active) return null;

  return (
    <AbsoluteFill>
      <div style={subtitleStyleToCss(resolved)}>
        {active.text}
      </div>
    </AbsoluteFill>
  );
};

/** Renders a single inline subtitle clip with resolved preset + override style. */
const InlineSubtitleClip: React.FC<{
  clip: ClipType;
  isSSR: boolean;
}> = ({ clip, isSSR }) => {
  const resolved = useResolvedStyle(clip);
  const textCss = subtitleStyleToCss(resolved);

  return (
    <AbsoluteFill>
      {isSSR ? (
        <div style={textCss}>{clip.subtitle_text}</div>
      ) : (
        <EditableText
          clipId={clip.id}
          field="subtitle_text"
          text={clip.subtitle_text!}
          style={textCss}
        />
      )}
    </AbsoluteFill>
  );
};

/** Renders a single video/image clip with spatial positioning, crop, and opacity. */
const VideoClipRenderer: React.FC<{
  clip: ClipType;
  mediaUrl: string;
  fps: number;
  isSSR?: boolean;
  isImage?: boolean;
}> = ({ clip, mediaUrl, fps, isSSR, isImage }) => {
  const vs = clip.video_style;
  const posX = vs?.position_x ?? 0.5;
  const posY = vs?.position_y ?? 0.5;
  const sizeW = vs?.width ?? 1.0;
  const sizeH = vs?.height ?? 1.0;
  const opacity = vs?.opacity ?? 1.0;
  const fit = vs?.fit ?? 'contain';
  const cropL = vs?.crop_left ?? 0;
  const cropT = vs?.crop_top ?? 0;
  const cropR = vs?.crop_right ?? 0;
  const cropB = vs?.crop_bottom ?? 0;
  const borderRadius = vs?.border_radius ?? 0;

  const hasCrop = cropL > 0 || cropT > 0 || cropR > 0 || cropB > 0;
  const isDefault =
    !vs ||
    (posX === 0.5 &&
      posY === 0.5 &&
      sizeW === 1.0 &&
      sizeH === 1.0 &&
      opacity === 1.0 &&
      !hasCrop &&
      borderRadius === 0);

  // Visible fraction of source after crop
  const visibleW = Math.max(1 - cropL - cropR, 0.1);
  const visibleH = Math.max(1 - cropT - cropB, 0.1);

  const containerStyle: React.CSSProperties = isDefault
    ? { width: '100%', height: '100%' }
    : {
        position: 'absolute',
        left: `${((posX - sizeW / 2) * 100).toFixed(2)}%`,
        top: `${((posY - sizeH / 2) * 100).toFixed(2)}%`,
        width: `${(sizeW * 100).toFixed(2)}%`,
        height: `${(sizeH * 100).toFixed(2)}%`,
        opacity,
        overflow: 'hidden',
        borderRadius: borderRadius > 0 ? borderRadius : undefined,
      };

  const videoStyle: React.CSSProperties = hasCrop
    ? {
        width: `${(100 / visibleW).toFixed(2)}%`,
        height: `${(100 / visibleH).toFixed(2)}%`,
        marginLeft: `${((-cropL / visibleW) * 100).toFixed(2)}%`,
        marginTop: `${((-cropT / visibleH) * 100).toFixed(2)}%`,
        objectFit: fit as React.CSSProperties['objectFit'],
      }
    : {
        width: '100%',
        height: '100%',
        objectFit: fit as React.CSSProperties['objectFit'],
      };

  if (isImage) {
    return (
      <div style={containerStyle}>
        <Img src={mediaUrl} style={videoStyle} />
      </div>
    );
  }

  const VideoComponent = isSSR ? OffthreadVideo : Video;

  return (
    <div style={containerStyle}>
      <VideoComponent
        src={mediaUrl}
        startFrom={Math.round((clip.source_in_sec ?? 0) * fps)}
        playbackRate={clip.speed ?? 1}
        style={videoStyle}
      />
    </div>
  );
};

interface TimelineCompositionProps {
  timeline: TimelineProject;
}

export const TimelineComposition: React.FC<TimelineCompositionProps> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  const isSSR = !!(timeline as any)._ssr;

  const videoTracks = timeline.tracks.filter((t) => t.type === 'video');
  const audioTracks = timeline.tracks.filter((t) => t.type === 'audio');
  const subtitleTracks = timeline.tracks.filter((t) => t.type === 'subtitle');

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Video tracks (bottom-up stacking: later tracks render on top) */}
      {videoTracks.map((track) =>
        track.muted
          ? null
          : track.clips.map((clip) => {
              const startFrame = Math.round(clip.timeline_start_sec * fps);
              const endFrame = Math.round(clip.timeline_end_sec * fps);
              const durationFrames = endFrame - startFrame;
              const mediaUrl = clip.media_id
                ? resolveMediaUrl(clip.media_id, timeline)
                : '';
              const mediaType = clip.media_id
                ? getMediaType(clip.media_id, timeline)
                : undefined;

              if (!mediaUrl || durationFrames < 1) return null;

              return (
                <Sequence
                  key={clip.id}
                  from={startFrame}
                  durationInFrames={durationFrames}
                >
                  <AbsoluteFill>
                    <VideoClipRenderer clip={clip} mediaUrl={mediaUrl} fps={fps} isSSR={isSSR} isImage={mediaType === 'image'} />
                  </AbsoluteFill>
                </Sequence>
              );
            }),
      )}

      {/* Audio tracks */}
      {audioTracks.map((track) =>
        track.muted
          ? null
          : track.clips.map((clip) => {
              const startFrame = Math.round(clip.timeline_start_sec * fps);
              const endFrame = Math.round(clip.timeline_end_sec * fps);
              const durationFrames = endFrame - startFrame;
              const mediaUrl = clip.media_id
                ? resolveMediaUrl(clip.media_id, timeline)
                : '';

              if (!mediaUrl || durationFrames < 1) return null;

              return (
                <Sequence
                  key={clip.id}
                  from={startFrame}
                  durationInFrames={durationFrames}
                >
                  <Audio
                    src={mediaUrl}
                    startFrom={Math.round((clip.source_in_sec ?? 0) * fps)}
                    playbackRate={clip.speed ?? 1}
                  />
                </Sequence>
              );
            }),
      )}

      {/* Subtitle tracks */}
      {subtitleTracks.map((track) =>
        track.muted
          ? null
          : track.clips.map((clip) => {
              const startFrame = Math.round(clip.timeline_start_sec * fps);
              const endFrame = Math.round(clip.timeline_end_sec * fps);
              const durationFrames = endFrame - startFrame;

              if (durationFrames < 1) return null;

              // SRT file-backed subtitle: has media_id but no inline text
              if (!clip.subtitle_text && clip.media_id) {
                return (
                  <Sequence
                    key={clip.id}
                    from={startFrame}
                    durationInFrames={durationFrames}
                  >
                    <SrtSubtitleClip clip={clip} timeline={timeline} fps={fps} />
                  </Sequence>
                );
              }

              // Inline subtitle text
              if (!clip.subtitle_text) return null;

              return (
                <Sequence
                  key={clip.id}
                  from={startFrame}
                  durationInFrames={durationFrames}
                >
                  <InlineSubtitleClip clip={clip} isSSR={!!(timeline as any)._ssr} />
                </Sequence>
              );
            }),
      )}

    </AbsoluteFill>
  );
};
