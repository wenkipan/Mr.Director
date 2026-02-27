import type { Clip, Track, MediaAsset, TimelineProject } from '@mrdv2/shared';
import { TRIM_HANDLE_WIDTH, MIN_CLIP_DURATION_SEC } from './timelineConstants';

/** Convert pixel offset to timeline seconds */
export function pxToSec(px: number, pixelsPerSec: number): number {
  return px / pixelsPerSec;
}

/** Convert timeline seconds to pixel offset */
export function secToPx(sec: number, pixelsPerSec: number): number {
  return sec * pixelsPerSec;
}

/** Check if a clip placement would overlap with other clips on the same track */
export function wouldOverlap(
  clipId: string,
  newStart: number,
  newDuration: number,
  trackClips: Clip[],
): boolean {
  const newEnd = newStart + newDuration;
  for (const c of trackClips) {
    if (c.id === clipId) continue;
    const cEnd = c.timeline_start_sec + c.duration_sec;
    if (newStart < cEnd && newEnd > c.timeline_start_sec) {
      return true;
    }
  }
  return false;
}

/** Collect all clip edge times across all tracks (for snapping) */
export function collectClipEdges(
  timeline: TimelineProject,
  excludeClipId?: string,
): number[] {
  const edges: number[] = [];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      edges.push(clip.timeline_start_sec);
      edges.push(clip.timeline_start_sec + clip.duration_sec);
    }
  }
  return edges;
}

/** Find the nearest snap point within threshold */
export function findSnapPoint(
  timeSec: number,
  snapTargets: number[],
  thresholdSec: number,
): { snappedTime: number; didSnap: boolean } {
  let closest = timeSec;
  let minDist = Infinity;
  for (const target of snapTargets) {
    const dist = Math.abs(timeSec - target);
    if (dist < minDist && dist <= thresholdSec) {
      minDist = dist;
      closest = target;
    }
  }
  return { snappedTime: closest, didSnap: minDist !== Infinity };
}

/** Determine what part of a clip the mouse is over */
export function hitTestClipRegion(
  mouseXInClip: number,
  clipWidthPx: number,
): 'body' | 'left-edge' | 'right-edge' {
  if (mouseXInClip <= TRIM_HANDLE_WIDTH) return 'left-edge';
  if (mouseXInClip >= clipWidthPx - TRIM_HANDLE_WIDTH) return 'right-edge';
  return 'body';
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Calculate total timeline duration from all clips */
export function calcTotalDuration(timeline: TimelineProject): number {
  let max = 1;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.timeline_start_sec + clip.duration_sec;
      if (end > max) max = end;
    }
  }
  return max + 2; // 2s padding
}

/** Deep clone a timeline (for undo snapshots) */
export function cloneTimeline(timeline: TimelineProject): TimelineProject {
  return JSON.parse(JSON.stringify(timeline));
}

/** Find a clip and its track by clip ID */
export function findClipById(
  timeline: TimelineProject,
  clipId: string,
): { clip: Clip; trackIndex: number; trackId: string } | null {
  for (let i = 0; i < timeline.tracks.length; i++) {
    const track = timeline.tracks[i];
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, trackIndex: i, trackId: track.id };
  }
  return null;
}

/** Apply a clip update immutably — returns a new TimelineProject */
export function updateClipInTimeline(
  timeline: TimelineProject,
  clipId: string,
  updates: Partial<Clip>,
): TimelineProject {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clip.id === clipId ? { ...clip, ...updates } : clip,
      ),
    })),
  };
}

/** Remove clips by IDs from timeline */
export function removeClipsFromTimeline(
  timeline: TimelineProject,
  clipIds: Set<string>,
): TimelineProject {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => !clipIds.has(clip.id)),
    })),
  };
}

/** Generate a unique track ID */
export function generateTrackId(): string {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `track_${hex}`;
}

/** Add a new track to the timeline */
export function addTrackToTimeline(
  timeline: TimelineProject,
  track: Track,
): TimelineProject {
  return {
    ...timeline,
    tracks: [...timeline.tracks, track],
  };
}

/** Remove a track by ID from the timeline */
export function removeTrackFromTimeline(
  timeline: TimelineProject,
  trackId: string,
): TimelineProject {
  return {
    ...timeline,
    tracks: timeline.tracks.filter((t) => t.id !== trackId),
  };
}

/** Reorder tracks by moving a track from one index to another */
export function reorderTracksInTimeline(
  timeline: TimelineProject,
  fromIndex: number,
  toIndex: number,
): TimelineProject {
  if (fromIndex === toIndex) return timeline;
  const tracks = [...timeline.tracks];
  const [moved] = tracks.splice(fromIndex, 1);
  tracks.splice(toIndex, 0, moved);
  return { ...timeline, tracks };
}

/** Generate a unique clip ID */
export function generateClipId(): string {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `clip_${hex}`;
}

/** Generate a deterministic media ID from file path (for dedup) */
export function generateMediaId(path: string): string {
  // Simple hash: use a short prefix + base64-ish of the path
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `media_${hex}`;
}

/** Add a clip to a specific track, optionally adding a media asset to the pool */
export function addClipToTimeline(
  timeline: TimelineProject,
  trackId: string,
  clip: Clip,
  mediaAsset?: MediaAsset,
): TimelineProject {
  const newTimeline = {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId
        ? { ...track, clips: [...track.clips, clip] }
        : track,
    ),
  };

  if (mediaAsset) {
    // Only add if not already in the pool
    const exists = newTimeline.media_pool.some((m) => m.id === mediaAsset.id);
    if (!exists) {
      newTimeline.media_pool = [...newTimeline.media_pool, mediaAsset];
    }
  }

  return newTimeline;
}

/** Split a clip at a given timeline time, producing two clips */
export function splitClipInTimeline(
  timeline: TimelineProject,
  clipId: string,
  splitAtSec: number,
): TimelineProject | null {
  const found = findClipById(timeline, clipId);
  if (!found) return null;

  const { clip, trackIndex } = found;
  const clipEnd = clip.timeline_start_sec + clip.duration_sec;

  // splitAtSec must be strictly inside the clip
  if (splitAtSec <= clip.timeline_start_sec || splitAtSec >= clipEnd) return null;

  const offsetInClip = splitAtSec - clip.timeline_start_sec;
  const speed = clip.speed ?? 1;
  const sourceSplit = (clip.source_in_sec ?? 0) + offsetInClip * speed;

  const clip1: Clip = {
    ...clip,
    id: generateClipId(),
    duration_sec: offsetInClip,
    source_out_sec: sourceSplit,
  };

  const clip2: Clip = {
    ...clip,
    id: generateClipId(),
    timeline_start_sec: splitAtSec,
    duration_sec: clip.duration_sec - offsetInClip,
    source_in_sec: sourceSplit,
  };

  return {
    ...timeline,
    tracks: timeline.tracks.map((track, idx) =>
      idx === trackIndex
        ? {
            ...track,
            clips: track.clips.flatMap((c) => (c.id === clipId ? [clip1, clip2] : [c])),
          }
        : track,
    ),
  };
}
