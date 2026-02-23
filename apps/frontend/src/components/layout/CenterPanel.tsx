import { useRef, useCallback, useEffect, useMemo } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { useAppStore } from '../../stores/appStore';
import { TimelineComposition } from '../../remotion/TimelineComposition';
import { calculateTotalFrames } from '../../lib/timelineAdapter';
import TimelineEditor from '../timeline/TimelineEditor';

export default function CenterPanel() {
  const { timeline, selectedMedia, currentFrame, setCurrentFrame, setPlaying } = useAppStore();
  const playerRef = useRef<PlayerRef>(null);

  const handleTimelineSeek = useCallback(
    (timeSec: number) => {
      if (!timeline) return;
      const frame = Math.round(timeSec * timeline.project.fps);
      playerRef.current?.seekTo(frame);
      setCurrentFrame(frame);
    },
    [timeline, setCurrentFrame],
  );

  // Sync player frame changes back to store
  // Use !!timeline so the effect re-runs once when Player first mounts (null→object),
  // but NOT on every subsequent timeline content update (object→object stays true).
  const hasTimeline = !!timeline;
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onFrameUpdate = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener('frameupdate', onFrameUpdate as any);
    player.addEventListener('play', onPlay as any);
    player.addEventListener('pause', onPause as any);
    return () => {
      player.removeEventListener('frameupdate', onFrameUpdate as any);
      player.removeEventListener('play', onPlay as any);
      player.removeEventListener('pause', onPause as any);
    };
  }, [hasTimeline, setCurrentFrame, setPlaying]);

  const fps = timeline?.project.fps ?? 30;
  const totalFrames = useMemo(
    () => (timeline ? calculateTotalFrames(timeline) : 1),
    [timeline],
  );
  const inputProps = useMemo(() => ({ timeline: timeline! }), [timeline]);

  // If we have a timeline, show Remotion player
  if (timeline && timeline.tracks.length > 0) {
    return (
      <div className="h-full flex flex-col bg-zinc-950">
        {/* Remotion Player */}
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
          <Player
            ref={playerRef}
            component={TimelineComposition}
            inputProps={inputProps}
            durationInFrames={totalFrames}
            fps={fps}
            compositionWidth={timeline.project.width}
            compositionHeight={timeline.project.height}
            controls
            style={{ width: '100%', maxHeight: '100%' }}
          />
        </div>

        {/* Timeline Editor */}
        <div className="h-[250px] border-t border-zinc-800 bg-zinc-900">
          <TimelineEditor
            timeline={timeline}
            currentTime={currentFrame / fps}
            onSeek={handleTimelineSeek}
          />
        </div>
      </div>
    );
  }

  // No timeline — show simple media preview or empty state
  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <div className="flex-1 flex items-center justify-center bg-black relative">
        {selectedMedia ? (
          <video
            key={selectedMedia}
            src={`/api/media/file?path=${encodeURIComponent(selectedMedia)}`}
            controls
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="text-zinc-600 text-sm">
            Select a media file to preview, or chat with the agent to create a timeline
          </div>
        )}
      </div>

      <div className="h-[250px] border-t border-zinc-800 bg-zinc-900 flex items-center justify-center">
        <div className="text-zinc-600 text-sm">No timeline loaded</div>
      </div>
    </div>
  );
}
