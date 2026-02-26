import { AbsoluteFill, Sequence, Video, Audio, useVideoConfig, useCurrentFrame } from 'remotion';
import type { TimelineProject, Clip as ClipType } from '@mrdv2/shared';
import { resolveMediaUrl } from '../lib/timelineAdapter';
import { parseSrt, type SrtEntry } from '../lib/srtParser';
import { useEffect, useState } from 'react';

/** Renders a single SRT-backed subtitle clip, fetching & parsing the .srt file.
 *  In SSR mode, clip._srt_content is pre-populated by the backend so no fetch is needed. */
const SrtSubtitleClip: React.FC<{
  clip: ClipType;
  timeline: TimelineProject;
  fps: number;
}> = ({ clip, timeline, fps }) => {
  const frame = useCurrentFrame(); // frame relative to this Sequence
  const [entries, setEntries] = useState<SrtEntry[]>([]);

  // SSR mode: backend injects raw SRT content directly into the clip
  const inlineSrt = (clip as any)._srt_content as string | undefined;
  const mediaUrl = clip.media_id ? resolveMediaUrl(clip.media_id, timeline) : '';

  useEffect(() => {
    // If inline SRT content is available (SSR mode), parse it directly
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

  // Current source time in the SRT file
  const sourceTime = (clip.source_in_sec ?? 0) + (frame / fps) * (clip.speed ?? 1);

  // Find the entry that covers the current source time
  const active = entries.find((e) => sourceTime >= e.startSec && sourceTime < e.endSec);
  if (!active) return null;

  const style = clip.subtitle_style;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: `${((1 - (style?.position_y ?? 0.85)) * 100).toFixed(0)}%`,
      }}
    >
      <div
        style={{
          fontFamily: style?.font_family ?? 'sans-serif',
          fontSize: style?.font_size ?? 48,
          color: style?.color ?? '#FFFFFF',
          backgroundColor: style?.background ?? 'rgba(0,0,0,0.6)',
          padding: '4px 16px',
          borderRadius: 4,
          textAlign: 'center',
          maxWidth: '80%',
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};

interface TimelineCompositionProps {
  timeline: TimelineProject;
}

export const TimelineComposition: React.FC<TimelineCompositionProps> = ({ timeline }) => {
  const { fps } = useVideoConfig();

  const videoTracks = timeline.tracks.filter((t) => t.type === 'video');
  const audioTracks = timeline.tracks.filter((t) => t.type === 'audio');
  const subtitleTracks = timeline.tracks.filter((t) => t.type === 'subtitle');
  const textTracks = timeline.tracks.filter((t) => t.type === 'text');

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Video tracks (bottom-up stacking) */}
      {videoTracks.map((track) =>
        track.muted
          ? null
          : track.clips.map((clip) => {
              const startFrame = Math.round(clip.timeline_start_sec * fps);
              const durationFrames = Math.round(clip.duration_sec * fps);
              const mediaUrl = clip.media_id
                ? resolveMediaUrl(clip.media_id, timeline)
                : '';

              if (!mediaUrl) return null;

              return (
                <Sequence
                  key={clip.id}
                  from={startFrame}
                  durationInFrames={durationFrames}
                >
                  <AbsoluteFill>
                    <Video
                      src={mediaUrl}
                      startFrom={Math.round((clip.source_in_sec ?? 0) * fps)}
                      playbackRate={clip.speed ?? 1}
                      volume={0}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
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
              const durationFrames = Math.round(clip.duration_sec * fps);
              const mediaUrl = clip.media_id
                ? resolveMediaUrl(clip.media_id, timeline)
                : '';

              if (!mediaUrl) return null;

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
              const durationFrames = Math.round(clip.duration_sec * fps);

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
              const style = clip.subtitle_style;

              return (
                <Sequence
                  key={clip.id}
                  from={startFrame}
                  durationInFrames={durationFrames}
                >
                  <AbsoluteFill
                    style={{
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      paddingBottom: `${((1 - (style?.position_y ?? 0.85)) * 100).toFixed(0)}%`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: style?.font_family ?? 'sans-serif',
                        fontSize: style?.font_size ?? 48,
                        color: style?.color ?? '#FFFFFF',
                        backgroundColor: style?.background ?? 'rgba(0,0,0,0.6)',
                        padding: '4px 16px',
                        borderRadius: 4,
                        textAlign: 'center',
                        maxWidth: '80%',
                      }}
                    >
                      {clip.subtitle_text}
                    </div>
                  </AbsoluteFill>
                </Sequence>
              );
            }),
      )}

      {/* Text overlay tracks (on top of subtitles) */}
      {textTracks.map((track) =>
        track.muted
          ? null
          : track.clips.map((clip) => {
              const startFrame = Math.round(clip.timeline_start_sec * fps);
              const durationFrames = Math.round(clip.duration_sec * fps);

              if (!clip.text_content) return null;
              const style = clip.text_style;

              return (
                <Sequence
                  key={clip.id}
                  from={startFrame}
                  durationInFrames={durationFrames}
                >
                  <AbsoluteFill
                    style={{
                      justifyContent: 'flex-start',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: `${((style?.position_x ?? 0.5) * 100).toFixed(1)}%`,
                        top: `${((style?.position_y ?? 0.5) * 100).toFixed(1)}%`,
                        transform: 'translate(-50%, -50%)',
                        fontFamily: style?.font_family ?? 'sans-serif',
                        fontSize: style?.font_size ?? 48,
                        color: style?.color ?? '#FFFFFF',
                        backgroundColor: style?.background ?? 'transparent',
                        textAlign: style?.text_align ?? 'center',
                        fontWeight: style?.bold ? 'bold' : 'normal',
                        fontStyle: style?.italic ? 'italic' : 'normal',
                        padding:
                          style?.background && style.background !== 'transparent'
                            ? '4px 16px'
                            : undefined,
                        borderRadius:
                          style?.background && style.background !== 'transparent'
                            ? 4
                            : undefined,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {clip.text_content}
                    </div>
                  </AbsoluteFill>
                </Sequence>
              );
            }),
      )}
    </AbsoluteFill>
  );
};
