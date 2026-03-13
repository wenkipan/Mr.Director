import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import TimelineCanvas from './TimelineCanvas';
import TimelineClipLayer from './TimelineClipLayer';
import TimelineTrackHeaders from './TimelineTrackHeaders';
import { useTimelineDrag } from './useTimelineDrag';
import { useMarqueeSelect } from './useMarqueeSelect';
import { useClipboardStore } from '../../stores/clipboardStore';
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  ADD_TRACK_ROW_HEIGHT,
  DEFAULT_PIXELS_PER_SEC,
  MIN_PIXELS_PER_SEC,
  MAX_PIXELS_PER_SEC,
  ZOOM_FACTOR,
} from './timelineConstants';
import {
  calcTotalDuration,
  removeClipsFromTimeline,
  splitClipInTimeline,
  generateClipId,
  findClipById,
  generateMediaId,
  addClipToTimeline,
  addTrackToTimeline,
  generateTrackId,
  findGapAtTime,
  removeGapOnTrack,
  removeGapAllTracks,
} from './timelineUtils';

interface TimelineEditorProps {
  timeline: TimelineProject;
  currentTime: number; // seconds
  onSeek: (timeSec: number) => void;
  onTimelineChange: (newTimeline: TimelineProject) => void;
  selectedClipIds: Set<string>;
  onSelectClip: (clipId: string, multi: boolean) => void;
  onSetSelection: (clipIds: Set<string>) => void;
  onClearSelection: () => void;
}

export default function TimelineEditor({
  timeline,
  currentTime,
  onSeek,
  onTimelineChange,
  selectedClipIds,
  onSelectClip,
  onSetSelection,
  onClearSelection,
}: TimelineEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(250);
  const [containerWidth, setContainerWidth] = useState(800);
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [dropTarget, setDropTarget] = useState<{ trackIndex: number; timeSec: number } | null>(null);
  const dragEnterCountRef = useRef(0);
  const { copiedClips, copyClips } = useClipboardStore();

  const [pixelsPerSec, setPixelsPerSec] = useState(DEFAULT_PIXELS_PER_SEC);
  const totalDuration = useMemo(() => calcTotalDuration(timeline), [timeline]);

  // Selection (lifted to parent)
  const selectClip = onSelectClip;
  const clearSelection = onClearSelection;

  // Drag (snap is computed internally, excluding the dragged clip)
  const { dragVisualState, startDrag } = useTimelineDrag(
    timeline,
    pixelsPerSec,
    currentTime,
    onTimelineChange,
    setSnapGuideTime,
    onSeek,
    selectedClipIds,
  );

  // Marquee selection
  const { marqueeRect, startMarquee } = useMarqueeSelect(
    timeline,
    pixelsPerSec,
    scrollRef,
    scrollTop,
    selectedClipIds,
    onSetSelection,
    onSeek,
    clearSelection,
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
      setContainerWidth(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel: Ctrl+wheel = zoom, track headers area = vertical scroll, else = horizontal scroll
  const pixelsPerSecRef = useRef(pixelsPerSec);
  pixelsPerSecRef.current = pixelsPerSec;
  const scrollTopRef = useRef(scrollTop);
  scrollTopRef.current = scrollTop;

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
        // Check if cursor is over the track headers area
        const rect = scrollEl.getBoundingClientRect();
        const cursorXInContent = e.clientX - rect.left + scrollEl.scrollLeft;

        if (cursorXInContent < HEADER_WIDTH) {
          // Vertical scroll for track headers
          const trackCount = timeline.tracks.length;
          const totalTrackHeight = RULER_HEIGHT + trackCount * TRACK_HEIGHT + ADD_TRACK_ROW_HEIGHT;
          const viewportHeight = scrollEl.clientHeight;
          const maxScroll = Math.max(0, totalTrackHeight - viewportHeight);
          const newScrollTop = Math.min(maxScroll, Math.max(0, scrollTopRef.current + e.deltaY));
          setScrollTop(newScrollTop);
        } else {
          scrollEl.scrollLeft += e.deltaY;
        }
      }
    };
    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', onWheel);
  }, [timeline.tracks.length]);

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

  // Click/drag on empty area → marquee select (or click-to-seek if no drag)
  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      startMarquee(e);
    },
    [startMarquee],
  );

  // --- Media drag-and-drop from MediaPanel ---
  const calcDropTarget = useCallback(
    (e: React.DragEvent) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return null;
      const rect = scrollEl.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollEl.scrollLeft - HEADER_WIDTH;
      const y = e.clientY - rect.top - RULER_HEIGHT + scrollTop;
      const trackIndex = Math.floor(y / TRACK_HEIGHT);
      const timeSec = Math.max(0, x / pixelsPerSec);
      if (trackIndex < 0 || trackIndex >= timeline.tracks.length) return null;
      return { trackIndex, timeSec };
    },
    [pixelsPerSec, timeline.tracks.length, scrollTop],
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

      const media: { name: string; path: string; type: string; duration?: number; width?: number; height?: number } = JSON.parse(raw);
      const target = calcDropTarget(e);
      if (!target) return;

      // Find a compatible track: prefer the hovered track, otherwise find/create one
      let targetTrack = timeline.tracks[target.trackIndex];
      let targetTrackId = targetTrack.id;
      let updatedTimeline = timeline;

      // Map media type to clip/track type
      // Allow video media on audio tracks (extracts audio from video)
      const isVideoOnAudioTrack = media.type === 'video' && targetTrack.type === 'audio';
      let clipType: 'video' | 'audio';
      if (isVideoOnAudioTrack) {
        clipType = 'audio';
      } else {
        clipType = media.type === 'audio' ? 'audio' : 'video';
      }

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

      // Auto-adapt project resolution to match the first video/image media
      const isVisualMedia = media.type === 'video' || media.type === 'image';
      if (isVisualMedia && media.width && media.height) {
        const hasExistingVisual = updatedTimeline.media_pool.some(
          (m) => m.type === 'video' || m.type === 'image',
        );
        if (!hasExistingVisual) {
          updatedTimeline = {
            ...updatedTimeline,
            project: { ...updatedTimeline.project, width: media.width, height: media.height },
          };
        }
      }

      const mediaId = generateMediaId(media.path);
      const isImageMedia = media.type === 'image';
      const duration = media.duration ?? 5;

      const timelineStart = Math.max(0, target.timeSec);
      const clip = {
        id: generateClipId(),
        type: clipType,
        media_id: mediaId,
        source_in_sec: 0,
        ...(isImageMedia ? {} : { source_out_sec: duration }),
        timeline_start_sec: timelineStart,
        timeline_end_sec: timelineStart + duration,
        speed: 1,
      };

      const mediaAsset = {
        id: mediaId,
        path: media.path,
        type: media.type === 'audio' ? 'audio' as const : media.type === 'image' ? 'image' as const : 'video' as const,
        ...(media.duration != null ? { duration_sec: media.duration } : {}),
        ...(media.width != null ? { width: media.width } : {}),
        ...(media.height != null ? { height: media.height } : {}),
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

      // Shift+Delete: remove gap at playhead
      if (e.key === 'Delete' && e.shiftKey && !isModKey) {
        e.preventDefault();
        const gaps = findGapAtTime(timeline, currentTime);
        if (gaps.length === 1) {
          const { trackId, gapStart, gapDuration } = gaps[0];
          onTimelineChange(removeGapOnTrack(timeline, trackId, gapStart, gapDuration));
        } else if (gaps.length > 1) {
          onTimelineChange(removeGapAllTracks(timeline, currentTime, gaps));
        }
        return;
      }

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

      // S key: split selected clip at playhead
      if (e.key === 's' && !isModKey && selectedClipIds.size === 1) {
        e.preventDefault();
        const clipId = [...selectedClipIds][0];
        const result = splitClipInTimeline(timeline, clipId, currentTime);
        if (result) {
          onTimelineChange(result);
          clearSelection();
        }
      }

      // Ctrl+C: Copy selected clips
      if (e.key === 'c' && isModKey && !e.shiftKey) {
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          const toCopy = [];
          for (const id of selectedClipIds) {
            const found = findClipById(timeline, id);
            if (found) {
              toCopy.push({ clip: found.clip, originalTrackId: found.trackId });
            }
          }
          if (toCopy.length > 0) {
            copyClips(toCopy);
          }
        }
      }

      // Ctrl+V: Paste copied clips at playhead
      if (e.key === 'v' && isModKey && !e.shiftKey) {
        if (copiedClips.length > 0) {
          e.preventDefault();
          let earliestStart = Infinity;
          for (const item of copiedClips) {
            if (item.clip.timeline_start_sec < earliestStart) {
              earliestStart = item.clip.timeline_start_sec;
            }
          }

          let updatedTimeline = timeline;
          const newSelectedIds = new Set<string>();

          for (const item of copiedClips) {
            const timeOffset = item.clip.timeline_start_sec - earliestStart;
            const newStart = Math.max(0, currentTime + timeOffset);
            const duration = item.clip.timeline_end_sec - item.clip.timeline_start_sec;

            const newClip = {
              ...item.clip,
              id: generateClipId(),
              timeline_start_sec: newStart,
              timeline_end_sec: newStart + duration,
            };

            let targetTrackId = item.originalTrackId;
            let targetTrack = updatedTimeline.tracks.find(t => t.id === targetTrackId);

            if (!targetTrack || targetTrack.locked || targetTrack.type !== newClip.type) {
              targetTrack = updatedTimeline.tracks.find(t => t.type === newClip.type && !t.locked);
              if (targetTrack) {
                targetTrackId = targetTrack.id;
              } else {
                targetTrackId = generateTrackId();
                const count = updatedTimeline.tracks.filter((t) => t.type === newClip.type).length + 1;
                const name = `${newClip.type.charAt(0).toUpperCase() + newClip.type.slice(1)} ${count}`;
                updatedTimeline = addTrackToTimeline(updatedTimeline, {
                  id: targetTrackId,
                  name,
                  type: newClip.type,
                  locked: false,
                  muted: false,
                  clips: [],
                });
              }
            }

            updatedTimeline = addClipToTimeline(updatedTimeline, targetTrackId, newClip);
            newSelectedIds.add(newClip.id);
          }

          onTimelineChange(updatedTimeline);
          onSetSelection(newSelectedIds);
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, timeline, currentTime, onTimelineChange, clearSelection]);

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
          scrollTop={scrollTop}
          scrollLeft={scrollLeft}
          viewportWidth={containerWidth}
        />

        <TimelineTrackHeaders
          timeline={timeline}
          onTimelineChange={onTimelineChange}
          scrollLeft={scrollLeft}
          scrollTop={scrollTop}
        />

        {/* Ruler click zone for seeking */}
        <div
          className="absolute left-0 top-0"
          style={{
            left: HEADER_WIDTH,
            height: RULER_HEIGHT,
            width: canvasWidth - HEADER_WIDTH,
            zIndex: 20,
            cursor: 'pointer',
          }}
          onPointerDown={handleBackgroundPointerDown}
        />

        <TimelineClipLayer
          timeline={timeline}
          pixelsPerSec={pixelsPerSec}
          selectedClipIds={selectedClipIds}
          scrollTop={scrollTop}
          contentWidth={canvasWidth}
          dragState={
            dragVisualState
              ? {
                clipId: dragVisualState.clipId,
                dragType: dragVisualState.dragType,
                offsetPx: dragVisualState.offsetPx,
                widthPx: dragVisualState.widthPx,
                leftPx: dragVisualState.leftPx,
                isMultiMove: dragVisualState.isMultiMove,
              }
              : null
          }
          onClipSelect={selectClip}
          onClipDragStart={startDrag}
          onBackgroundPointerDown={handleBackgroundPointerDown}
        />

        {/* Marquee selection overlay */}
        {marqueeRect && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: marqueeRect.x,
              top: marqueeRect.y - scrollTop,
              width: marqueeRect.width,
              height: marqueeRect.height,
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.6)',
              zIndex: 30,
            }}
          />
        )}

        {/* Drop target visual feedback */}
        {dropTarget && (
          <>
            {/* Track highlight */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: HEADER_WIDTH,
                top: RULER_HEIGHT + dropTarget.trackIndex * TRACK_HEIGHT - scrollTop,
                right: 0,
                height: TRACK_HEIGHT,
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderTop: '1px solid rgba(59, 130, 246, 0.4)',
                borderBottom: '1px solid rgba(59, 130, 246, 0.4)',
                clipPath: `inset(${RULER_HEIGHT}px 0 0 0)`,
                zIndex: 25,
              }}
            />
            {/* Time position indicator */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: HEADER_WIDTH + dropTarget.timeSec * pixelsPerSec,
                top: RULER_HEIGHT - scrollTop,
                width: 0,
                height: timeline.tracks.length * TRACK_HEIGHT,
                borderLeft: '2px dashed rgba(59, 130, 246, 0.7)',
                clipPath: `inset(${RULER_HEIGHT}px 0 0 0)`,
                zIndex: 25,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
