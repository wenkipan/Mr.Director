import { useMemo, useCallback } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import { SNAP_THRESHOLD_PX } from './timelineConstants';
import { collectClipEdges, findSnapPoint } from './timelineUtils';

export function useTimelineSnap(
  timeline: TimelineProject,
  playheadSec: number,
  pixelsPerSec: number,
  excludeClipId?: string,
) {
  const snapTargets = useMemo(() => {
    const edges = collectClipEdges(timeline, excludeClipId);
    // Add playhead as a snap target
    edges.push(playheadSec);
    // Add 0 as a target (timeline start)
    edges.push(0);
    return edges;
  }, [timeline, playheadSec, excludeClipId]);

  const findSnap = useCallback(
    (timeSec: number): { snappedTime: number; didSnap: boolean } => {
      const thresholdSec = SNAP_THRESHOLD_PX / pixelsPerSec;
      return findSnapPoint(timeSec, snapTargets, thresholdSec);
    },
    [snapTargets, pixelsPerSec],
  );

  return { snapTargets, findSnap };
}
