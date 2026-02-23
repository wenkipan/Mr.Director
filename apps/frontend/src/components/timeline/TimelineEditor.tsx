import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import TimelineCanvas from './TimelineCanvas';
import TimelineClipLayer from './TimelineClipLayer';
import TimelineTrackHeaders from './TimelineTrackHeaders';
import { useTimelineSelection } from './useTimelineSelection';
import { useTimelineDrag } from './useTimelineDrag';
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  DEFAULT_PIXELS_PER_SEC,
  MIN_PIXELS_PER_SEC,
  MAX_PIXELS_PER_SEC,
  ZOOM_FACTOR,
} from './timelineConstants';
import {
  calcTotalDuration,
  removeClipsFromTimeline,
  generateClipId,
  generateMediaId,
  addClipToTimeline,
  addTrackToTimeline,
  generateTrackId,
} from './timelineUtils';

interface TimelineEditorProps {
  timeline: TimelineProject;
  currentTime: number; // seconds
  onSeek: (timeSec: number) => void;
  onTimelineChange: (newTimeline: TimelineProject) => void;
}

export default function TimelineEditor({
  timeline,
  currentTime,
  onSeek,
  onTimelineChange,
}: TimelineEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(250);
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [dropTarget, setDropTarget] = useState<{ trackIndex: number; timeSec: number } | null>(null);
  const dragEnterCountRef = useRef(0);

  const [pixelsPerSec, setPixelsPerSec] = useState(DEFAULT_PIXELS_PER_SEC);
  const totalDuration = useMemo(() => calcTotalDuration(timeline), [timeline]);

  // Selection
  const { selectedClipIds, selectClip, clearSelection } = useTimelineSelection();

  // Drag (snap is computed internally, excluding the dragged clip)
  const { dragVisualState, startDrag } = useTimelineDrag(
    timeline,
    pixelsPerSec,
    currentTime,
    onTimelineChange,
    setSnapGuideTime,
  );

  // Calculate canvas size
  const canvasWidth = useMemo(() => {
    const el = containerRef.current;
    const minWidth = el ? el.clientWidth : 800;
    return Math.max(minWidth, HEADER_WIDTH + totalDuration * pixelsPerSec);
  }, [totalDuration, pixelsPerSec]);

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel: Ctrl+wheel = zoom (anchored to cursor), plain wheel = horizontal scroll
  const pixelsPerSecRef = useRef(pixelsPerSec);
  pixelsPerSecRef.current = pixelsPerSec;

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Zoom: anchor to cursor position
        const rect = scrollEl.getBoundingClientRect();
        const cursorX = e.clientX - rect.left; // px from left edge of viewport
        const oldPPS = pixelsPerSecRef.current;
        // Time under cursor before zoom
        const timeSec = (scrollEl.scrollLeft + cursorX - HEADER_WIDTH) / oldPPS;

        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const newPPS = Math.min(MAX_PIXELS_PER_SEC, Math.max(MIN_PIXELS_PER_SEC, oldPPS * factor));
        setPixelsPerSec(newPPS);

        // Adjust scroll so the same time stays under cursor
        scrollEl.scrollLeft = timeSec * newPPS - cursorX + HEADER_WIDTH;
      } else {
        scrollEl.scrollLeft += e.deltaY;
      }
    };
    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', onWheel);
  }, []);

  // Track scroll position for sticky track headers
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const onScroll = () => setScrollLeft(scrollEl.scrollLeft);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const playheadX = HEADER_WIDTH + currentTime * pixelsPerSec;
    const { scrollLeft, clientWidth } = scrollEl;
    const margin = clientWidth * 0.15;
    if (playheadX > scrollLeft + clientWidth - margin) {
      scrollEl.scrollLeft = playheadX - clientWidth * 0.3;
    } else if (playheadX < scrollLeft + HEADER_WIDTH) {
      scrollEl.scrollLeft = Math.max(0, playheadX - HEADER_WIDTH - margin);
    }
  }, [currentTime, pixelsPerSec]);

  // Click on empty area → seek
  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== e.currentTarget) return;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const rect = scrollEl.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollEl.scrollLeft - HEADER_WIDTH;
      if (x >= 0) {
        onSeek(Math.max(0, x / pixelsPerSec));
      }
      clearSelection();
    },
    [onSeek, pixelsPerSec, clearSelection],
  );

  // --- Media drag-and-drop from MediaPanel ---
  const calcDropTarget = useCallback(
    (e: React.DragEvent) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return null;
      const rect = scrollEl.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollEl.scrollLeft - HEADER_WIDTH;
      const y = e.clientY - rect.top - RULER_HEIGHT;
      const trackIndex = Math.floor(y / TRACK_HEIGHT);
      const timeSec = Math.max(0, x / pixelsPerSec);
      if (trackIndex < 0 || trackIndex >= timeline.tracks.length) return null;
      return { trackIndex, timeSec };
    },
    [pixelsPerSec, timeline.tracks.length],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-mrdv2-media')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget(calcDropTarget(e));
    },
    [calcDropTarget],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-mrdv2-media')) return;
      e.preventDefault();
      dragEnterCountRef.current++;
    },
    [],
  );

  const handleDragLeave = useCallback(
    () => {
      dragEnterCountRef.current--;
      if (dragEnterCountRef.current <= 0) {
        dragEnterCountRef.current = 0;
        setDropTarget(null);
      }
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragEnterCountRef.current = 0;
      setDropTarget(null);

      const raw = e.dataTransfer.getData('application/x-mrdv2-media');
      if (!raw) return;

      const media: { name: string; path: string; type: string } = JSON.parse(raw);
      const target = calcDropTarget(e);
      if (!target) return;

      // Map media type to clip/track type
      const clipType: 'video' | 'audio' = media.type === 'audio' ? 'audio' : 'video';

      // Find a compatible track: prefer the hovered track, otherwise find/create one
      let targetTrack = timeline.tracks[target.trackIndex];
      let targetTrackId = targetTrack.id;
      let updatedTimeline = timeline;

      if (targetTrack.type !== clipType) {
        // Try to find an existing compatible track
        const compatibleTrack = timeline.tracks.find((t) => t.type === clipType);
        if (compatibleTrack) {
          targetTrackId = compatibleTrack.id;
        } else {
          // Create a new track of the correct type
          const newTrackId = generateTrackId();
          const count = timeline.tracks.filter((t) => t.type === clipType).length + 1;
          const name = `${clipType.charAt(0).toUpperCase() + clipType.slice(1)} ${count}`;
          updatedTimeline = addTrackToTimeline(timeline, {
            id: newTrackId,
            name,
            type: clipType,
            locked: false,
            muted: false,
            clips: [],
          });
          targetTrackId = newTrackId;
        }
      }

      const mediaId = generateMediaId(media.path);
      const defaultDuration = 5;

      const clip = {
        id: generateClipId(),
        type: clipType,
        media_id: mediaId,
        source_in_sec: 0,
        source_out_sec: defaultDuration,
        timeline_start_sec: Math.max(0, target.timeSec),
        duration_sec: defaultDuration,
        speed: 1,
      };

      const mediaAsset = {
        id: mediaId,
        path: media.path,
        type: media.type === 'audio' ? 'audio' as const : media.type === 'image' ? 'image' as const : 'video' as const,
      };

      onTimelineChange(addClipToTimeline(updatedTimeline, targetTrackId, clip, mediaAsset));
    },
    [timeline, calcDropTarget, onTimelineChange],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isModKey = e.ctrlKey || e.metaKey;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.size > 0) {
        e.preventDefault();
        const newTimeline = removeClipsFromTimeline(timeline, selectedClipIds);
        onTimelineChange(newTimeline);
        clearSelection();
      }

      if (e.key === 'z' && isModKey && !e.shiftKey) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('timeline:undo'));
      }

      if (e.key === 'z' && isModKey && e.shiftKey) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('timeline:redo'));
      }

      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, timeline, onTimelineChange, clearSelection]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full focus:outline-none"
      tabIndex={0}
    >
      <div
        ref={scrollRef}
        className="w-full h-full overflow-x-auto overflow-y-hidden relative"
        style={{ cursor: 'default' }}
        onPointerDown={handleBackgroundPointerDown}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <TimelineCanvas
          timeline={timeline}
          currentTime={currentTime}
          totalDuration={totalDuration}
          pixelsPerSec={pixelsPerSec}
          snapGuideTime={snapGuideTime}
          canvasWidth={canvasWidth}
          height={containerHeight}
        />

        <TimelineTrackHeaders
          timeline={timeline}
          onTimelineChange={onTimelineChange}
          scrollLeft={scrollLeft}
        />

        <TimelineClipLayer
          timeline={timeline}
          pixelsPerSec={pixelsPerSec}
          selectedClipIds={selectedClipIds}
          dragState={
            dragVisualState
              ? {
                  clipId: dragVisualState.clipId,
                  dragType: dragVisualState.dragType,
                  offsetPx: dragVisualState.offsetPx,
                  widthPx: dragVisualState.widthPx,
                  leftPx: dragVisualState.leftPx,
                }
              : null
          }
          onClipSelect={selectClip}
          onClipDragStart={startDrag}
          onBackgroundClick={clearSelection}
        />

        {/* Drop target visual feedback */}
        {dropTarget && (
          <>
            {/* Track highlight */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: HEADER_WIDTH,
                top: RULER_HEIGHT + dropTarget.trackIndex * TRACK_HEIGHT,
                right: 0,
                height: TRACK_HEIGHT,
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderTop: '1px solid rgba(59, 130, 246, 0.4)',
                borderBottom: '1px solid rgba(59, 130, 246, 0.4)',
                zIndex: 25,
              }}
            />
            {/* Time position indicator */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: HEADER_WIDTH + dropTarget.timeSec * pixelsPerSec,
                top: RULER_HEIGHT,
                width: 0,
                height: timeline.tracks.length * TRACK_HEIGHT,
                borderLeft: '2px dashed rgba(59, 130, 246, 0.7)',
                zIndex: 25,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
