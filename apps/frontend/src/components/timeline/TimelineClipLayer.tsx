import { memo, useMemo } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import TimelineClip, { type DragType } from './TimelineClip';
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  CLIP_PADDING,
} from './timelineConstants';

interface DragState {
  clipId: string;
  dragType: DragType;
  /** Pixel offset from drag start for 'move' type */
  offsetPx: number;
  /** Override width in px for trim operations */
  widthPx: number | null;
  /** Override left in px for trim-left operations */
  leftPx: number | null;
  /** When true, all selected clips move together */
  isMultiMove?: boolean;
}

interface TimelineClipLayerProps {
  timeline: TimelineProject;
  pixelsPerSec: number;
  selectedClipIds: Set<string>;
  scrollTop: number;
  contentWidth: number;
  dragState: DragState | null;
  onClipSelect: (clipId: string, multi: boolean) => void;
  onClipDragStart: (clipId: string, type: DragType, pointerX: number) => void;
  onBackgroundPointerDown: (e: React.PointerEvent) => void;
}

export default memo(function TimelineClipLayer({
  timeline,
  pixelsPerSec,
  selectedClipIds,
  scrollTop,
  contentWidth,
  dragState,
  onClipSelect,
  onClipDragStart,
  onBackgroundPointerDown,
}: TimelineClipLayerProps) {
  const clipHeight = TRACK_HEIGHT - CLIP_PADDING * 2;

  // Build lookup maps: media_id → display name, file path
  // Memoized so we don't rebuild O(n) maps on every render.
  const { mediaNameMap, mediaPathMap } = useMemo(() => {
    const names = new Map<string, string>();
    const paths = new Map<string, string>();
    for (const asset of timeline.media_pool) {
      const fileName = asset.path.split('/').pop() || asset.path;
      names.set(asset.id, fileName);
      paths.set(asset.id, asset.path);
    }
    return { mediaNameMap: names, mediaPathMap: paths };
  }, [timeline.media_pool]);

  return (
    <div
      className="absolute top-0 left-0 h-full"
      style={{ width: contentWidth, clipPath: `inset(${RULER_HEIGHT}px 0 0 0)` }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          onBackgroundPointerDown(e);
        }
      }}
    >
      {timeline.tracks.map((track, trackIndex) =>
        track.clips.map((clip) => {
          const left = HEADER_WIDTH + clip.timeline_start_sec * pixelsPerSec;
          const top = RULER_HEIGHT + trackIndex * TRACK_HEIGHT + CLIP_PADDING - scrollTop;
          const width = (clip.timeline_end_sec - clip.timeline_start_sec) * pixelsPerSec;
          const isDragging = dragState?.clipId === clip.id;
          const isMoving = dragState?.dragType === 'move' && (
            isDragging ||
            (dragState.isMultiMove && selectedClipIds.has(clip.id))
          );

          return (
            <TimelineClip
              key={clip.id}
              clip={clip}
              trackType={track.type}
              mediaName={clip.media_id ? mediaNameMap.get(clip.media_id) : undefined}
              mediaFilePath={clip.media_id ? mediaPathMap.get(clip.media_id) : undefined}
              left={left}
              top={top}
              width={width}
              height={clipHeight}
              selected={selectedClipIds.has(clip.id)}
              dragOffsetPx={isMoving ? dragState!.offsetPx : 0}
              dragWidth={isDragging ? dragState.widthPx : null}
              dragLeft={isDragging ? dragState.leftPx : null}
              onSelect={onClipSelect}
              onDragStart={onClipDragStart}
            />
          );
        }),
      )}
    </div>
  );
});
