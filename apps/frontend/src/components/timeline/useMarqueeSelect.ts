import { useState, useCallback, useRef } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  MARQUEE_THRESHOLD_PX,
} from './timelineConstants';
import { getClipIdsInRect } from './timelineUtils';

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export function useMarqueeSelect(
  timeline: TimelineProject,
  pixelsPerSec: number,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  scrollTop: number,
  selectedClipIds: Set<string>,
  onSetSelection: (ids: Set<string>) => void,
  onSeek: (timeSec: number) => void,
  onClearSelection: () => void,
): {
  marqueeRect: MarqueeRect | null;
  startMarquee: (e: React.PointerEvent) => void;
} {
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  // Refs to avoid stale closures in document-level listeners
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const pixelsPerSecRef = useRef(pixelsPerSec);
  pixelsPerSecRef.current = pixelsPerSec;
  const scrollTopRef = useRef(scrollTop);
  scrollTopRef.current = scrollTop;
  const selectedClipIdsRef = useRef(selectedClipIds);
  selectedClipIdsRef.current = selectedClipIds;

  const prevSelectionRef = useRef<Set<string>>(new Set());

  const startMarquee = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const startContentX = e.clientX - rect.left + scrollEl.scrollLeft;
      const startContentY = e.clientY - rect.top + scrollTopRef.current;

      // Guard: ignore clicks in track header area (left column)
      if (startContentX < HEADER_WIDTH) return;

      // Ruler click/drag → seek (scrub)
      if (startContentY < RULER_HEIGHT) {
        const seekFromX = (clientX: number) => {
          const x = clientX - rect.left + scrollEl.scrollLeft - HEADER_WIDTH;
          if (x >= 0) onSeek(Math.max(0, x / pixelsPerSecRef.current));
        };
        seekFromX(e.clientX);

        const onRulerMove = (ev: PointerEvent) => seekFromX(ev.clientX);
        const onRulerUp = () => {
          document.removeEventListener('pointermove', onRulerMove);
          document.removeEventListener('pointerup', onRulerUp);
        };
        document.addEventListener('pointermove', onRulerMove);
        document.addEventListener('pointerup', onRulerUp);
        return;
      }

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const isAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
      const snapshotSelection = new Set(selectedClipIdsRef.current);
      let isDragging = false;

      const onPointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isDragging && dist < MARQUEE_THRESHOLD_PX) return;
        isDragging = true;

        const currentContentX = ev.clientX - rect.left + scrollEl.scrollLeft;
        const currentContentY = ev.clientY - rect.top + scrollTopRef.current;

        const mx = Math.min(startContentX, currentContentX);
        const my = Math.min(startContentY, currentContentY);
        const mw = Math.abs(currentContentX - startContentX);
        const mh = Math.abs(currentContentY - startContentY);

        const marquee = { x: mx, y: my, width: mw, height: mh };
        setMarqueeRect(marquee);

        const intersected = getClipIdsInRect(
          timelineRef.current,
          marquee,
          pixelsPerSecRef.current,
        );

        let newSelection: Set<string>;
        if (isAdditive) {
          newSelection = new Set(snapshotSelection);
          for (const id of intersected) newSelection.add(id);
        } else {
          newSelection = intersected;
        }

        if (!setsEqual(newSelection, prevSelectionRef.current)) {
          prevSelectionRef.current = newSelection;
          onSetSelection(newSelection);
        }
      };

      const onPointerUp = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        setMarqueeRect(null);
        prevSelectionRef.current = new Set();

        if (!isDragging) {
          // Click without drag → seek + clear
          const x = ev.clientX - rect.left + scrollEl.scrollLeft - HEADER_WIDTH;
          if (x >= 0) {
            onSeek(Math.max(0, x / pixelsPerSecRef.current));
          }
          onClearSelection();
        }
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [scrollRef, onSetSelection, onSeek, onClearSelection],
  );

  return { marqueeRect, startMarquee };
}
