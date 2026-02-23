import { useCallback, useRef } from 'react';
import type { Clip } from '@mrdv2/shared';
import { TRACK_COLORS, CLIP_PADDING, TRIM_HANDLE_WIDTH } from './timelineConstants';
import { hitTestClipRegion } from './timelineUtils';

export type DragType = 'move' | 'trim-left' | 'trim-right';

interface TimelineClipProps {
  clip: Clip;
  trackType: string;
  mediaName?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  /** Transient offset during drag (pixels) — only for 'move' drag type */
  dragOffsetPx: number;
  /** Transient width override during trim */
  dragWidth: number | null;
  /** Transient left override during trim-left */
  dragLeft: number | null;
  onSelect: (clipId: string, multi: boolean) => void;
  onDragStart: (clipId: string, type: DragType, pointerX: number) => void;
}

export default function TimelineClip({
  clip,
  trackType,
  mediaName,
  left,
  top,
  width,
  height,
  selected,
  dragOffsetPx,
  dragWidth,
  dragLeft,
  onSelect,
  onDragStart,
}: TimelineClipProps) {
  const clipRef = useRef<HTMLDivElement>(null);
  const color = TRACK_COLORS[trackType] || '#6b7280';

  const actualLeft = dragLeft !== null ? dragLeft : left + dragOffsetPx;
  const actualWidth = dragWidth !== null ? dragWidth : width;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();

      // Determine drag type from cursor position within clip
      const rect = clipRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseXInClip = e.clientX - rect.left;
      const region = hitTestClipRegion(mouseXInClip, actualWidth);

      // Always select on pointer down
      onSelect(clip.id, e.ctrlKey || e.metaKey);

      const dragType: DragType =
        region === 'left-edge'
          ? 'trim-left'
          : region === 'right-edge'
            ? 'trim-right'
            : 'move';
      onDragStart(clip.id, dragType, e.clientX);
    },
    [clip.id, actualWidth, onSelect, onDragStart],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = clipRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseXInClip = e.clientX - rect.left;
      const region = hitTestClipRegion(mouseXInClip, actualWidth);
      const el = clipRef.current;
      if (!el) return;
      if (region === 'left-edge' || region === 'right-edge') {
        el.style.cursor = 'col-resize';
      } else {
        el.style.cursor = 'grab';
      }
    },
    [actualWidth],
  );

  const label =
    clip.type === 'subtitle'
      ? clip.subtitle_text?.slice(0, 20) || 'Sub'
      : mediaName || clip.media_id || clip.id;

  return (
    <div
      ref={clipRef}
      className="absolute select-none overflow-hidden"
      style={{
        left: actualLeft,
        top,
        width: Math.max(actualWidth, 2),
        height,
        borderRadius: 3,
        backgroundColor: color + '99',
        border: selected ? `2px solid ${color}` : `1px solid ${color}`,
        boxSizing: 'border-box',
        zIndex: selected ? 10 : 1,
      }}
      onPointerDown={handlePointerDown}
      onMouseMove={handleMouseMove}
    >
      {/* Left trim handle (invisible but changes cursor) */}
      <div
        className="absolute top-0 left-0 h-full"
        style={{ width: TRIM_HANDLE_WIDTH, cursor: 'col-resize' }}
      />

      {/* Clip label */}
      {actualWidth > 40 && (
        <div
          className="px-1.5 text-white text-[10px] leading-none whitespace-nowrap overflow-hidden pointer-events-none"
          style={{ lineHeight: `${height}px` }}
        >
          {label}
        </div>
      )}

      {/* Right trim handle */}
      <div
        className="absolute top-0 right-0 h-full"
        style={{ width: TRIM_HANDLE_WIDTH, cursor: 'col-resize' }}
      />
    </div>
  );
}
