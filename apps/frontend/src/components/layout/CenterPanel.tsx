import { useRef, useCallback, useEffect, useMemo } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { useAppStore } from '../../stores/appStore';
import { useInlineEditStore } from '../../stores/inlineEditStore';
import { TimelineComposition } from '../../remotion/TimelineComposition';
import { calculateTotalFrames } from '../../lib/timelineAdapter';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useMediaPrefetch } from '../../hooks/useMediaPrefetch';
import { useSelectionStore } from '../../stores/selectionStore';
import TimelineEditor from '../timeline/TimelineEditor';
import TimelineToolbar from '../timeline/TimelineToolbar';
import Toolbar from './Toolbar';

export default function CenterPanel() {
  const { timeline, selectedMedia, currentFrame, setCurrentFrame, setPlaying, updateTimeline, undo, redo } =
    useAppStore();
  const playerRef = useRef<PlayerRef>(null);
  const { selectedClipIds, selectClip, clearSelection } = useSelectionStore();

  // Auto-save on timeline edits (1s debounce)
  useAutoSave(1000);

  // Prefetch all media pool assets so edits don't trigger re-downloads
  useMediaPrefetch(timeline);

  // Listen for undo/redo custom events dispatched from TimelineEditor keyboard shortcuts
  useEffect(() => {
    const handleUndo = () => undo();
    const handleRedo = () => redo();
    document.addEventListener('timeline:undo', handleUndo);
    document.addEventListener('timeline:redo', handleRedo);
    return () => {
      document.removeEventListener('timeline:undo', handleUndo);
      document.removeEventListener('timeline:redo', handleRedo);
    };
  }, [undo, redo]);

  // Pause player when inline text editing starts; auto-commit if playback resumes
  useEffect(() => {
    const handleEditStart = () => {
      playerRef.current?.pause();
    };
    document.addEventListener('inlineEdit:start', handleEditStart);
    return () => document.removeEventListener('inlineEdit:start', handleEditStart);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handlePlay = () => {
      const { editingClipId, commitEdit } = useInlineEditStore.getState();
      if (editingClipId) commitEdit();
    };
    player.addEventListener('play', handlePlay as any);
    return () => player.removeEventListener('play', handlePlay as any);
  }, [!!timeline]);

  const handleTimelineSeek = useCallback(
    (timeSec: number) => {
      if (!timeline) return;
      const frame = Math.round(timeSec * timeline.project.fps);
      playerRef.current?.seekTo(frame);
      setCurrentFrame(frame);
    },
    [timeline, setCurrentFrame],
  );

  const handleTimelineChange = useCallback(
    (newTimeline: typeof timeline) => {
      if (!newTimeline) return;
      updateTimeline(newTimeline);
    },
    [updateTimeline],
  );

  // Sync player frame changes back to store
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
        <Toolbar />
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
            clickToPlay={false}
            doubleClickToFullscreen={false}
            style={{ width: '100%', maxHeight: '100%' }}
          />
        </div>

        {/* Timeline Toolbar */}
        <TimelineToolbar
          timeline={timeline}
          selectedClipIds={selectedClipIds}
          currentTime={currentFrame / fps}
          onTimelineChange={handleTimelineChange}
        />

        {/* Timeline Editor */}
        <div className="h-[250px] border-t border-zinc-800 bg-zinc-900">
          <TimelineEditor
            timeline={timeline}
            currentTime={currentFrame / fps}
            onSeek={handleTimelineSeek}
            onTimelineChange={handleTimelineChange}
            selectedClipIds={selectedClipIds}
            onSelectClip={selectClip}
            onClearSelection={clearSelection}
          />
        </div>
      </div>
    );
  }

  // No timeline — show simple media preview or empty state
  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <Toolbar />
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
