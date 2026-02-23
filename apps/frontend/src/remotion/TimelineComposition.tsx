import { AbsoluteFill, Sequence, Video, Audio, useVideoConfig } from 'remotion';
import type { TimelineProject } from '@mrdv2/shared';
import { resolveMediaUrl } from '../lib/timelineAdapter';

interface TimelineCompositionProps {
  timeline: TimelineProject;
}

export const TimelineComposition: React.FC<TimelineCompositionProps> = ({ timeline }) => {
  const { fps } = useVideoConfig();

  const videoTracks = timeline.tracks.filter((t) => t.type === 'video');
  const audioTracks = timeline.tracks.filter((t) => t.type === 'audio');
  const subtitleTracks = timeline.tracks.filter((t) => t.type === 'subtitle');

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
              if (!clip.subtitle_text) return null;
              const startFrame = Math.round(clip.timeline_start_sec * fps);
              const durationFrames = Math.round(clip.duration_sec * fps);
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
    </AbsoluteFill>
  );
};
