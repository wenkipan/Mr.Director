import { useCallback, useState, useRef, useEffect } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import TrackHeader from './TrackHeader';
import AddTrackButton from './AddTrackButton';
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  ADD_TRACK_ROW_HEIGHT,
} from './timelineConstants';
import {
  addTrackToTimeline,
  removeTrackFromTimeline,
  reorderTracksInTimeline,
  generateTrackId,
  clamp,
} from './timelineUtils';

interface TimelineTrackHeadersProps {
  timeline: TimelineProject;
  onTimelineChange: (newTimeline: TimelineProject) => void;
  scrollLeft: number;
}

interface DragState {
  fromIndex: number;
  startY: number;
  currentY: number;
}

export default function TimelineTrackHeaders({
  timeline,
  onTimelineChange,
  scrollLeft,
}: TimelineTrackHeadersProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const timelineRef = useRef(timeline);
  const onTimelineChangeRef = useRef(onTimelineChange);
  timelineRef.current = timeline;
  onTimelineChangeRef.current = onTimelineChange;

  // Compute drop target index from current pointer Y
  const getDropIndex = useCallback(
    (currentY: number, fromIndex: number): number => {
      const container = containerRef.current;
      if (!container) return fromIndex;
      const rect = container.getBoundingClientRect();
      const relativeY = currentY - rect.top - RULER_HEIGHT;
      const rawIndex = Math.round(relativeY / TRACK_HEIGHT);
      return clamp(rawIndex, 0, timelineRef.current.tracks.length - 1);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const updated = { ...d, currentY: e.clientY };
      dragRef.current = updated;
      setDragState(updated);
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    const d = dragRef.current;
    if (d) {
      const toIndex = getDropIndex(d.currentY, d.fromIndex);
      if (toIndex !== d.fromIndex) {
        onTimelineChangeRef.current(
          reorderTracksInTimeline(timelineRef.current, d.fromIndex, toIndex),
        );
      }
    }
    dragRef.current = null;
    setDragState(null);
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  }, [getDropIndex, handlePointerMove]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handleDragStart = useCallback(
    (trackId: string, pointerY: number) => {
      const fromIndex = timeline.tracks.findIndex((t) => t.id === trackId);
      if (fromIndex === -1) return;
      const state: DragState = { fromIndex, startY: pointerY, currentY: pointerY };
      dragRef.current = state;
      setDragState(state);
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    },
    [timeline.tracks, handlePointerMove, handlePointerUp],
  );

  const handleAddTrack = useCallback(
    (type: 'video' | 'audio' | 'subtitle') => {
      const id = generateTrackId();
      const count = timeline.tracks.filter((t) => t.type === type).length + 1;
      const name = `${type.charAt(0).toUpperCase() + type.slice(1)} ${count}`;
      onTimelineChange(
        addTrackToTimeline(timeline, {
          id,
          name,
          type,
          locked: false,
          muted: false,
          clips: [],
        }),
      );
    },
    [timeline, onTimelineChange],
  );

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      const track = timeline.tracks.find((t) => t.id === trackId);
      if (track && track.clips.length > 0) {
        if (
          !window.confirm(
            `Track "${track.name || track.type}" has ${track.clips.length} clip(s). Delete anyway?`,
          )
        ) {
          return;
        }
      }
      onTimelineChange(removeTrackFromTimeline(timeline, trackId));
    },
    [timeline, onTimelineChange],
  );

  const dropIndex = dragState ? getDropIndex(dragState.currentY, dragState.fromIndex) : -1;

  return (
    <div
      ref={containerRef}
      className="absolute top-0 left-0"
      style={{
        width: HEADER_WIDTH,
        height: '100%',
        transform: `translateX(${scrollLeft}px)`,
        zIndex: 20,
      }}
    >
      {/* Track headers */}
      {timeline.tracks.map((track, index) => (
        <div
          key={track.id}
          className="absolute left-0"
          style={{
            top: RULER_HEIGHT + index * TRACK_HEIGHT,
            width: HEADER_WIDTH,
            height: TRACK_HEIGHT,
            opacity: dragState?.fromIndex === index ? 0.3 : 1,
            transition: dragState ? 'none' : 'opacity 0.15s',
          }}
        >
          <TrackHeader
            track={track}
            onDelete={handleDeleteTrack}
            onDragStart={handleDragStart}
          />
        </div>
      ))}

      {/* Drop indicator line */}
      {dragState && dropIndex >= 0 && dropIndex !== dragState.fromIndex && (
        <div
          className="absolute left-1 right-1 pointer-events-none"
          style={{
            top:
              RULER_HEIGHT +
              (dropIndex > dragState.fromIndex ? dropIndex + 1 : dropIndex) *
                TRACK_HEIGHT -
              1,
            height: 2,
            backgroundColor: '#3b82f6',
            borderRadius: 1,
          }}
        />
      )}

      {/* Floating drag preview */}
      {dragState && (
        <div
          className="pointer-events-none"
          style={{
            position: 'fixed',
            left: containerRef.current
              ? containerRef.current.getBoundingClientRect().left
              : 0,
            top: dragState.currentY - TRACK_HEIGHT / 2,
            width: HEADER_WIDTH,
            height: TRACK_HEIGHT,
            opacity: 0.8,
            zIndex: 30,
            backgroundColor: '#27272a',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <TrackHeader
            track={timeline.tracks[dragState.fromIndex]}
            onDelete={() => {}}
            onDragStart={() => {}}
          />
        </div>
      )}

      {/* Add track button */}
      <div
        className="absolute left-0"
        style={{
          top: RULER_HEIGHT + timeline.tracks.length * TRACK_HEIGHT,
          width: HEADER_WIDTH,
          height: ADD_TRACK_ROW_HEIGHT,
        }}
      >
        <AddTrackButton onAddTrack={handleAddTrack} />
      </div>
    </div>
  );
}
