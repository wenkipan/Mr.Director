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
}

interface TimelineClipLayerProps {
  timeline: TimelineProject;
  pixelsPerSec: number;
  selectedClipIds: Set<string>;
  dragState: DragState | null;
  onClipSelect: (clipId: string, multi: boolean) => void;
  onClipDragStart: (clipId: string, type: DragType, pointerX: number) => void;
  onBackgroundClick: () => void;
}

export default function TimelineClipLayer({
  timeline,
  pixelsPerSec,
  selectedClipIds,
  dragState,
  onClipSelect,
  onClipDragStart,
  onBackgroundClick,
}: TimelineClipLayerProps) {
  const clipHeight = TRACK_HEIGHT - CLIP_PADDING * 2;

  // Build a lookup map: media_id → display name (filename without extension)
  const mediaNameMap = new Map<string, string>();
  for (const asset of timeline.media_pool) {
    const fileName = asset.path.split('/').pop() || asset.path;
    mediaNameMap.set(asset.id, fileName);
  }

  return (
    <div
      className="absolute top-0 left-0 w-full h-full"
      onPointerDown={(e) => {
        // Click on background (not on a clip) → clear selection
        if (e.target === e.currentTarget) {
          onBackgroundClick();
        }
      }}
    >
      {timeline.tracks.map((track, trackIndex) =>
        track.clips.map((clip) => {
          const left = HEADER_WIDTH + clip.timeline_start_sec * pixelsPerSec;
          const top = RULER_HEIGHT + trackIndex * TRACK_HEIGHT + CLIP_PADDING;
          const width = clip.duration_sec * pixelsPerSec;
          const isDragging = dragState?.clipId === clip.id;

          return (
            <TimelineClip
              key={clip.id}
              clip={clip}
              trackType={track.type}
              mediaName={clip.media_id ? mediaNameMap.get(clip.media_id) : undefined}
              left={left}
              top={top}
              width={width}
              height={clipHeight}
              selected={selectedClipIds.has(clip.id)}
              dragOffsetPx={isDragging && dragState.dragType === 'move' ? dragState.offsetPx : 0}
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
}
