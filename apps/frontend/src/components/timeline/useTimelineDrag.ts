import { useState, useCallback, useRef, useEffect } from 'react';
import type { Clip, TimelineProject } from '@mrdv2/shared';
import type { DragType } from './TimelineClip';
import { useAppStore } from '../../stores/appStore';
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  MIN_CLIP_DURATION_SEC,
  SNAP_THRESHOLD_PX,
} from './timelineConstants';
import {
  pxToSec,
  secToPx,
  wouldOverlap,
  clamp,
  findClipById,
  updateClipInTimeline,
  collectClipEdges,
  findSnapPoint,
  findInsertPoint,
  rippleInsertClip,
} from './timelineUtils';

export interface InsertIndicator {
  trackIndex: number;
  timeSec: number;
  targetTrackId: string;
}

export interface DragVisualState {
  clipId: string;
  dragType: DragType;
  /** Pixel offset from original position (for 'move') */
  offsetPx: number;
  /** Override width in px (for trim) */
  widthPx: number | null;
  /** Override left in px (for trim-left) */
  leftPx: number | null;
  /** When true, all clips in selectedClipIds should apply the same offsetPx */
  isMultiMove: boolean;
  /** Insert mode indicator (Alt+drag) */
  insertIndicator: InsertIndicator | null;
}

interface MultiClipInfo {
  clipId: string;
  trackId: string;
  originalStart: number;
  duration: number;
  trackClips: Clip[];
}

interface InternalDragState {
  clipId: string;
  trackId: string;
  dragType: DragType;
  originalClip: Clip;
  startMouseX: number;
  pixelsPerSec: number;
  trackClips: Clip[];
  mediaMaxDuration: number | null;
  isMultiMove: boolean;
  multiClips: MultiClipInfo[];
}

export function useTimelineDrag(
  timeline: TimelineProject,
  pixelsPerSec: number,
  onTimelineChange: (newTimeline: TimelineProject) => void,
  onSnapGuide: (timeSec: number | null) => void,
  onSeek: (timeSec: number) => void,
  selectedClipIds: Set<string>,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  scrollTopRef: React.RefObject<number>,
) {
  const [visualState, setVisualState] = useState<DragVisualState | null>(null);
  const dragRef = useRef<InternalDragState | null>(null);
  const visualRef = useRef<DragVisualState | null>(null);
  /** Cached snap edges — built once at drag start to avoid O(n) per pointermove */
  const snapEdgesRef = useRef<number[]>([]);
  const timelineRef = useRef(timeline);
  const currentTimeRef = useRef(0);
  const onTimelineChangeRef = useRef(onTimelineChange);
  const onSnapGuideRef = useRef(onSnapGuide);
  const onSeekRef = useRef(onSeek);
  const pixelsPerSecRef = useRef(pixelsPerSec);
  const selectedClipIdsRef = useRef(selectedClipIds);

  timelineRef.current = timeline;
  onTimelineChangeRef.current = onTimelineChange;
  onSnapGuideRef.current = onSnapGuide;
  onSeekRef.current = onSeek;
  pixelsPerSecRef.current = pixelsPerSec;
  selectedClipIdsRef.current = selectedClipIds;

  // Sync currentTimeRef from store without causing re-renders
  const fpsRef = useRef(timeline.project.fps || 30);
  fpsRef.current = timeline.project.fps || 30;
  useEffect(() => {
    currentTimeRef.current = useAppStore.getState().currentFrame / fpsRef.current;
    const unsub = useAppStore.subscribe((state) => {
      currentTimeRef.current = state.currentFrame / fpsRef.current;
    });
    return unsub;
  }, []);

  /** Compute snap using cached edges (built at drag start).
   *  Playhead is checked live since it can move during drag. */
  const computeSnap = useCallback((timeSec: number): { snappedTime: number; didSnap: boolean } => {
    const edges = snapEdgesRef.current;
    // Playhead is dynamic — append without mutating the cached array
    const dynamicEdges = [...edges, currentTimeRef.current];
    const thresholdSec = SNAP_THRESHOLD_PX / pixelsPerSecRef.current;
    return findSnapPoint(timeSec, dynamicEdges, thresholdSec);
  }, []);

  const startDrag = useCallback(
    (clipId: string, dragType: DragType, pointerX: number) => {
      const tl = timelineRef.current;
      const found = findClipById(tl, clipId);
      if (!found) return;
      const { clip, trackId } = found;
      const track = tl.tracks.find((t) => t.id === trackId);
      if (!track) return;

      let mediaMaxDuration: number | null = null;
      if (clip.media_id) {
        const asset = tl.media_pool.find((m) => m.id === clip.media_id);
        if (asset?.duration_sec) mediaMaxDuration = asset.duration_sec;
      }

      // Build multi-clip info for 'move' only
      const currentSelection = selectedClipIdsRef.current;
      const isMultiMove = dragType === 'move'
        && currentSelection.size > 1
        && currentSelection.has(clipId);

      const multiClips: MultiClipInfo[] = [];
      if (isMultiMove) {
        for (const id of currentSelection) {
          if (id === clipId) continue;
          const f = findClipById(tl, id);
          if (!f) continue;
          const t = tl.tracks.find((tr) => tr.id === f.trackId);
          if (!t) continue;
          multiClips.push({
            clipId: id,
            trackId: f.trackId,
            originalStart: f.clip.timeline_start_sec,
            duration: f.clip.timeline_end_sec - f.clip.timeline_start_sec,
            trackClips: t.clips,
          });
        }
      }

      dragRef.current = {
        clipId,
        trackId,
        dragType,
        originalClip: { ...clip },
        startMouseX: pointerX,
        pixelsPerSec: pixelsPerSecRef.current,
        trackClips: track.clips,
        mediaMaxDuration,
        isMultiMove,
        multiClips,
      };

      // Pre-compute snap edges once — avoids O(n) traversal on every pointermove
      const excludeIds = isMultiMove
        ? new Set([clipId, ...multiClips.map((mc) => mc.clipId)])
        : clipId;
      const edges = collectClipEdges(tl, excludeIds);
      edges.push(0); // timeline start is always a snap target
      snapEdgesRef.current = edges;

      visualRef.current = {
        clipId,
        dragType,
        offsetPx: 0,
        widthPx: null,
        leftPx: null,
        isMultiMove,
        insertIndicator: null,
      };
      setVisualState(visualRef.current);

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    },
    [],
  );

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const onSnapGuideFn = onSnapGuideRef.current;
    const deltaPx = e.clientX - d.startMouseX;
    const deltaSec = pxToSec(deltaPx, d.pixelsPerSec);

    if (d.dragType === 'move') {
      let newStart = d.originalClip.timeline_start_sec + deltaSec;
      newStart = Math.max(0, newStart);

      // Snap start edge
      const snapStart = computeSnap(newStart);
      if (snapStart.didSnap) {
        newStart = snapStart.snappedTime;
        onSnapGuideFn(snapStart.snappedTime);
      } else {
        // Try snapping end edge
        const origDuration = d.originalClip.timeline_end_sec - d.originalClip.timeline_start_sec;
        const newEnd = newStart + origDuration;
        const snapEnd = computeSnap(newEnd);
        if (snapEnd.didSnap) {
          newStart = snapEnd.snappedTime - origDuration;
          onSnapGuideFn(snapEnd.snappedTime);
        } else {
          onSnapGuideFn(null);
        }
      }

      newStart = Math.max(0, newStart);
      const effectiveDelta = newStart - d.originalClip.timeline_start_sec;

      // --- Insert mode (Alt + single clip move) ---
      let insertIndicator: InsertIndicator | null = null;
      if (e.altKey && !d.isMultiMove) {
        const scrollEl = scrollRef.current;
        const tl = timelineRef.current;
        if (scrollEl) {
          const rect = scrollEl.getBoundingClientRect();
          const y = e.clientY - rect.top - RULER_HEIGHT + (scrollTopRef.current ?? 0);
          const trackIndex = Math.floor(y / TRACK_HEIGHT);
          if (trackIndex >= 0 && trackIndex < tl.tracks.length) {
            const targetTrack = tl.tracks[trackIndex];
            if (!targetTrack.locked && (targetTrack.type === d.originalClip.type ||
                (targetTrack.type === 'video' || targetTrack.type === 'audio') &&
                (d.originalClip.type === 'video' || d.originalClip.type === 'audio'))) {
              const x = e.clientX - rect.left + scrollEl.scrollLeft - HEADER_WIDTH;
              const timeSec = Math.max(0, x / d.pixelsPerSec);
              const ip = findInsertPoint(targetTrack, timeSec, d.clipId);
              insertIndicator = {
                trackIndex,
                timeSec: ip.insertTime,
                targetTrackId: targetTrack.id,
              };
              // Show snap guide at insert point
              onSnapGuideRef.current(null);
            }
          }
        }
      }

      // In insert mode, skip overlap check (ripple will handle it)
      if (!insertIndicator) {
        // Boundary check: no clip below 0
        if (d.isMultiMove) {
          for (const mc of d.multiClips) {
            if (mc.originalStart + effectiveDelta < 0) return;
          }
        }

        // Overlap check — exclude all selected clips from collision
        const excludeIds = d.isMultiMove
          ? new Set([d.clipId, ...d.multiClips.map((mc) => mc.clipId)])
          : undefined;

        if (wouldOverlap(d.clipId, newStart, d.originalClip.timeline_end_sec - d.originalClip.timeline_start_sec, d.trackClips, excludeIds)) {
          return;
        }

        if (d.isMultiMove) {
          for (const mc of d.multiClips) {
            if (wouldOverlap(mc.clipId, mc.originalStart + effectiveDelta, mc.duration, mc.trackClips, excludeIds)) {
              return;
            }
          }
        }
      }

      const offsetPx = secToPx(effectiveDelta, d.pixelsPerSec);
      visualRef.current = {
        clipId: d.clipId,
        dragType: 'move',
        offsetPx,
        widthPx: null,
        leftPx: null,
        isMultiMove: d.isMultiMove,
        insertIndicator,
      };
      setVisualState(visualRef.current);
      onSeekRef.current(newStart);

    } else if (d.dragType === 'trim-left') {
      const orig = d.originalClip;
      const speed = orig.speed ?? 1;
      const origDuration = orig.timeline_end_sec - orig.timeline_start_sec;
      const origSourceIn = orig.source_in_sec ?? 0;
      const origSourceOut = orig.source_out_sec ?? origSourceIn + origDuration * speed;

      let newSourceIn = origSourceIn + deltaSec * speed;
      newSourceIn = clamp(newSourceIn, 0, origSourceOut - MIN_CLIP_DURATION_SEC * speed);

      // When source_in decreases, clip starts earlier → timeline_start decreases
      let newTimelineStart = orig.timeline_start_sec + (newSourceIn - origSourceIn) / speed;

      // Snap the left edge
      const snapResult = computeSnap(newTimelineStart);
      if (snapResult.didSnap) {
        newTimelineStart = snapResult.snappedTime;
        onSnapGuideFn(snapResult.snappedTime);
        // Recalculate source_in from the snapped start
        newSourceIn = origSourceIn + (newTimelineStart - orig.timeline_start_sec) * speed;
        newSourceIn = clamp(newSourceIn, 0, origSourceOut - MIN_CLIP_DURATION_SEC * speed);
      } else {
        onSnapGuideFn(null);
      }

      const finalDuration = (origSourceOut - newSourceIn) / speed;
      const leftPx = HEADER_WIDTH + newTimelineStart * d.pixelsPerSec;
      const widthPx = finalDuration * d.pixelsPerSec;

      visualRef.current = {
        clipId: d.clipId,
        dragType: 'trim-left',
        offsetPx: 0,
        widthPx,
        leftPx,
        isMultiMove: false,
        insertIndicator: null,
      };
      setVisualState(visualRef.current);
      onSeekRef.current(newTimelineStart);

    } else if (d.dragType === 'trim-right') {
      const orig = d.originalClip;
      const speed = orig.speed ?? 1;
      const origDuration = orig.timeline_end_sec - orig.timeline_start_sec;
      const origSourceIn = orig.source_in_sec ?? 0;
      const origSourceOut = orig.source_out_sec ?? origSourceIn + origDuration * speed;

      let newSourceOut = origSourceOut + deltaSec * speed;
      const minOut = origSourceIn + MIN_CLIP_DURATION_SEC * speed;
      const maxOut = d.mediaMaxDuration ?? Infinity;
      newSourceOut = clamp(newSourceOut, minOut, maxOut);

      const newDuration = (newSourceOut - origSourceIn) / speed;
      const newEnd = orig.timeline_start_sec + newDuration;

      // Snap the right edge
      const snapResult = computeSnap(newEnd);
      if (snapResult.didSnap) {
        const finalEnd = snapResult.snappedTime;
        onSnapGuideFn(finalEnd);
        newSourceOut = origSourceIn + (finalEnd - orig.timeline_start_sec) * speed;
        newSourceOut = clamp(newSourceOut, minOut, maxOut);
      } else {
        onSnapGuideFn(null);
      }

      const finalDuration = (newSourceOut - origSourceIn) / speed;
      const widthPx = finalDuration * d.pixelsPerSec;

      visualRef.current = {
        clipId: d.clipId,
        dragType: 'trim-right',
        offsetPx: 0,
        widthPx,
        leftPx: null,
        isMultiMove: false,
        insertIndicator: null,
      };
      setVisualState(visualRef.current);
      onSeekRef.current(orig.timeline_start_sec + finalDuration);
    }
  }, [computeSnap]);

  const handlePointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;

    const vs = visualRef.current;
    const tl = timelineRef.current;

    if (vs) {
      const orig = d.originalClip;
      const speed = orig.speed ?? 1;
      let newTimeline = tl;

      if (d.dragType === 'move') {
        if (vs.insertIndicator) {
          // Insert mode: ripple insert
          newTimeline = rippleInsertClip(
            tl,
            d.clipId,
            vs.insertIndicator.targetTrackId,
            vs.insertIndicator.timeSec,
          );
        } else {
          // Normal overwrite move
          const deltaSec = pxToSec(vs.offsetPx, d.pixelsPerSec);
          const newStart = Math.max(0, orig.timeline_start_sec + deltaSec);
          const origDuration = orig.timeline_end_sec - orig.timeline_start_sec;
          newTimeline = updateClipInTimeline(tl, d.clipId, {
            timeline_start_sec: newStart,
            timeline_end_sec: newStart + origDuration,
          });
          // Apply same delta to secondary clips
          if (d.isMultiMove) {
            const effectiveDelta = newStart - orig.timeline_start_sec;
            for (const mc of d.multiClips) {
              const mcNewStart = Math.max(0, mc.originalStart + effectiveDelta);
              newTimeline = updateClipInTimeline(newTimeline, mc.clipId, {
                timeline_start_sec: mcNewStart,
                timeline_end_sec: mcNewStart + mc.duration,
              });
            }
          }
        }
      } else if (d.dragType === 'trim-left' && vs.leftPx !== null && vs.widthPx !== null) {
        const newStart = pxToSec(vs.leftPx - HEADER_WIDTH, d.pixelsPerSec);
        const newDuration = pxToSec(vs.widthPx, d.pixelsPerSec);
        const origDuration = orig.timeline_end_sec - orig.timeline_start_sec;
        const origSourceOut = orig.source_out_sec ?? (orig.source_in_sec ?? 0) + origDuration * speed;
        const newSourceIn = origSourceOut - newDuration * speed;
        newTimeline = updateClipInTimeline(tl, d.clipId, {
          timeline_start_sec: newStart,
          timeline_end_sec: newStart + newDuration,
          source_in_sec: Math.max(0, newSourceIn),
        });
      } else if (d.dragType === 'trim-right' && vs.widthPx !== null) {
        const newDuration = pxToSec(vs.widthPx, d.pixelsPerSec);
        const origSourceIn = orig.source_in_sec ?? 0;
        const newSourceOut = origSourceIn + newDuration * speed;
        newTimeline = updateClipInTimeline(tl, d.clipId, {
          timeline_end_sec: orig.timeline_start_sec + newDuration,
          source_out_sec: newSourceOut,
        });
      }

      onTimelineChangeRef.current(newTimeline);
    }

    onSnapGuideRef.current(null);
    dragRef.current = null;
    visualRef.current = null;
    setVisualState(null);

    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove]);

  useEffect(() => {
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return { dragVisualState: visualState, startDrag };
}
