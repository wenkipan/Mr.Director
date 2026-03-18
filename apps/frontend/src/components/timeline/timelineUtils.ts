import type { Clip, Track, MediaAsset, TimelineProject } from '@mrdv2/shared';
import {
  TRIM_HANDLE_WIDTH,
  MIN_CLIP_DURATION_SEC,
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  CLIP_PADDING,
} from './timelineConstants';

const GAP_EPSILON = 1e-6;

/** Info about a gap on one track at a given time */
export interface GapInfo {
  trackId: string;
  trackName: string;
  gapStart: number;
  gapDuration: number;
}

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
  excludeIds?: Set<string>,
): boolean {
  const newEnd = newStart + newDuration;
  for (const c of trackClips) {
    if (c.id === clipId) continue;
    if (excludeIds?.has(c.id)) continue;
    const cEnd = c.timeline_end_sec;
    if (newStart < cEnd && newEnd > c.timeline_start_sec) {
      return true;
    }
  }
  return false;
}

/** Collect all clip edge times across all tracks (for snapping) */
export function collectClipEdges(
  timeline: TimelineProject,
  excludeClipId?: string | Set<string>,
): number[] {
  const edges: number[] = [];
  const excludeSet = excludeClipId instanceof Set
    ? excludeClipId
    : excludeClipId ? new Set([excludeClipId]) : undefined;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (excludeSet?.has(clip.id)) continue;
      edges.push(clip.timeline_start_sec);
      edges.push(clip.timeline_end_sec);
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
      const end = clip.timeline_end_sec;
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

/** Check if two clips can be merged (same track, adjacent, compatible) */
export function canMergeClips(
  timeline: TimelineProject,
  clipId1: string,
  clipId2: string,
): boolean {
  return mergeClipsInTimeline(timeline, clipId1, clipId2) !== null;
}

/** Merge two adjacent clips on the same track into one. Returns null if not mergeable. */
export function mergeClipsInTimeline(
  timeline: TimelineProject,
  clipId1: string,
  clipId2: string,
): TimelineProject | null {
  const found1 = findClipById(timeline, clipId1);
  const found2 = findClipById(timeline, clipId2);
  if (!found1 || !found2) return null;

  // Must be on the same track
  if (found1.trackIndex !== found2.trackIndex) return null;

  // Sort by timeline position
  const [first, second] =
    found1.clip.timeline_start_sec <= found2.clip.timeline_start_sec
      ? [found1.clip, found2.clip]
      : [found2.clip, found1.clip];

  // Must be precisely adjacent
  if (first.timeline_end_sec !== second.timeline_start_sec) return null;

  // Must be same type
  if (first.type !== second.type) return null;

  // Type-specific checks for video/audio
  if (first.type === 'video' || first.type === 'audio') {
    if (first.media_id !== second.media_id) return null;
    if ((first.speed ?? 1) !== (second.speed ?? 1)) return null;
    if (first.source_out_sec == null || second.source_in_sec == null) return null;
    if (first.source_out_sec !== second.source_in_sec) return null;
  }

  // Build merged clip (inherit from first)
  const merged: Clip = {
    ...first,
    timeline_end_sec: second.timeline_end_sec,
  };

  if (first.type === 'video' || first.type === 'audio') {
    merged.source_out_sec = second.source_out_sec;
  }

  if (first.type === 'subtitle') {
    const t1 = first.subtitle_text || '';
    const t2 = second.subtitle_text || '';
    merged.subtitle_text = t1 && t2 ? `${t1}\n${t2}` : t1 || t2;
  }

  const trackIndex = found1.trackIndex;
  const removeIds = new Set([first.id, second.id]);

  return {
    ...timeline,
    tracks: timeline.tracks.map((track, idx) =>
      idx === trackIndex
        ? {
            ...track,
            clips: track.clips.flatMap((c) =>
              removeIds.has(c.id) ? (c.id === first.id ? [merged] : []) : [c],
            ),
          }
        : track,
    ),
  };
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

  // splitAtSec must be strictly inside the clip
  if (splitAtSec <= clip.timeline_start_sec || splitAtSec >= clip.timeline_end_sec) return null;

  const offsetInClip = splitAtSec - clip.timeline_start_sec;
  const speed = clip.speed ?? 1;
  const sourceSplit = (clip.source_in_sec ?? 0) + offsetInClip * speed;

  const clip1: Clip = {
    ...clip,
    id: generateClipId(),
    timeline_end_sec: splitAtSec,
    source_out_sec: sourceSplit,
  };

  const clip2: Clip = {
    ...clip,
    id: generateClipId(),
    timeline_start_sec: splitAtSec,
    timeline_end_sec: clip.timeline_end_sec,
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

/** Find gaps at the given time across all non-locked tracks */
export function findGapAtTime(
  timeline: TimelineProject,
  currentTime: number,
): GapInfo[] {
  const result: GapInfo[] = [];
  for (const track of timeline.tracks) {
    if (track.locked) continue;
    if (track.clips.length === 0) continue;
    const sorted = [...track.clips].sort(
      (a, b) => a.timeline_start_sec - b.timeline_start_sec,
    );
    // Gap before first clip
    const first = sorted[0];
    if (
      first.timeline_start_sec > GAP_EPSILON &&
      currentTime >= GAP_EPSILON &&
      currentTime <= first.timeline_start_sec + GAP_EPSILON
    ) {
      result.push({
        trackId: track.id,
        trackName: track.name ?? track.id,
        gapStart: 0,
        gapDuration: first.timeline_start_sec,
      });
      continue;
    }
    // Gaps between consecutive clips
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = sorted[i].timeline_end_sec;
      const gapEnd = sorted[i + 1].timeline_start_sec;
      if (gapEnd - gapStart <= GAP_EPSILON) continue;
      if (
        currentTime >= gapStart - GAP_EPSILON &&
        currentTime <= gapEnd + GAP_EPSILON
      ) {
        result.push({
          trackId: track.id,
          trackName: track.name ?? track.id,
          gapStart,
          gapDuration: gapEnd - gapStart,
        });
        break;
      }
    }
  }
  return result;
}

/** Remove a gap on a single track by shifting all clips after gapStart backward */
export function removeGapOnTrack(
  timeline: TimelineProject,
  trackId: string,
  gapStart: number,
  gapDuration: number,
): TimelineProject {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.timeline_start_sec < gapStart + GAP_EPSILON) return clip;
          return {
            ...clip,
            timeline_start_sec: clip.timeline_start_sec - gapDuration,
            timeline_end_sec: clip.timeline_end_sec - gapDuration,
          };
        }),
      };
    }),
  };
}

/** Remove gaps on all tracks by shifting clips after currentTime by the minimum gap duration */
export function removeGapAllTracks(
  timeline: TimelineProject,
  currentTime: number,
  gaps: GapInfo[],
): TimelineProject {
  if (gaps.length === 0) return timeline;
  const shiftAmount = Math.min(...gaps.map((g) => g.gapDuration));
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.timeline_start_sec < currentTime - GAP_EPSILON) return clip;
          const newStart = Math.max(0, clip.timeline_start_sec - shiftAmount);
          const newEnd = newStart + (clip.timeline_end_sec - clip.timeline_start_sec);
          return {
            ...clip,
            timeline_start_sec: newStart,
            timeline_end_sec: newEnd,
          };
        }),
      };
    }),
  };
}

/** Apply the same updates to multiple clips by ID */
export function updateClipsInTimeline(
  timeline: TimelineProject,
  clipIds: Set<string>,
  updates: Partial<Clip>,
): TimelineProject {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clipIds.has(clip.id) ? { ...clip, ...updates } : clip,
      ),
    })),
  };
}

/** Find the insertion point on a track closest to the given time.
 *  Returns the time where the dragged clip should be placed and
 *  the ID of the clip it will be inserted before (null = append). */
export function findInsertPoint(
  track: Track,
  timeSec: number,
  excludeClipId?: string,
): { insertTime: number; insertBeforeClipId: string | null } {
  const sorted = track.clips
    .filter((c) => c.id !== excludeClipId)
    .sort((a, b) => a.timeline_start_sec - b.timeline_start_sec);

  if (sorted.length === 0) {
    return { insertTime: 0, insertBeforeClipId: null };
  }

  // Find the clip whose start edge is closest to timeSec,
  // or detect that we're past all clips (append).
  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i];
    const midpoint =
      (clip.timeline_start_sec + clip.timeline_end_sec) / 2;
    if (timeSec <= midpoint) {
      // Insert before this clip
      return { insertTime: clip.timeline_start_sec, insertBeforeClipId: clip.id };
    }
  }

  // Past all clips → append after last
  const last = sorted[sorted.length - 1];
  return { insertTime: last.timeline_end_sec, insertBeforeClipId: null };
}

/** Execute a ripple insert: remove clip from source, close source gap,
 *  open space at insertTime on target track, place clip there. */
export function rippleInsertClip(
  timeline: TimelineProject,
  clipId: string,
  targetTrackId: string,
  insertTime: number,
): TimelineProject {
  const found = findClipById(timeline, clipId);
  if (!found) return timeline;

  const { clip, trackId: sourceTrackId } = found;
  const clipDuration = clip.timeline_end_sec - clip.timeline_start_sec;
  const clipOrigStart = clip.timeline_start_sec;

  // Step 1: Remove clip from source track + ripple close the gap
  let newTimeline: TimelineProject = {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id !== sourceTrackId) return track;
      return {
        ...track,
        clips: track.clips
          .filter((c) => c.id !== clipId)
          .map((c) => {
            // Shift clips after the removed clip leftward
            if (c.timeline_start_sec > clipOrigStart + GAP_EPSILON) {
              return {
                ...c,
                timeline_start_sec: c.timeline_start_sec - clipDuration,
                timeline_end_sec: c.timeline_end_sec - clipDuration,
              };
            }
            return c;
          }),
      };
    }),
  };

  // Step 2: Adjust insertTime if same track and clip was before insert point
  let adjustedInsertTime = insertTime;
  if (sourceTrackId === targetTrackId && clipOrigStart < insertTime - GAP_EPSILON) {
    adjustedInsertTime = insertTime - clipDuration;
  }

  // Step 3: On target track, shift clips at/after insertTime rightward + place clip
  const placedClip: Clip = {
    ...clip,
    timeline_start_sec: adjustedInsertTime,
    timeline_end_sec: adjustedInsertTime + clipDuration,
  };

  newTimeline = {
    ...newTimeline,
    tracks: newTimeline.tracks.map((track) => {
      if (track.id !== targetTrackId) return track;
      const shifted = track.clips.map((c) => {
        if (c.timeline_start_sec >= adjustedInsertTime - GAP_EPSILON) {
          return {
            ...c,
            timeline_start_sec: c.timeline_start_sec + clipDuration,
            timeline_end_sec: c.timeline_end_sec + clipDuration,
          };
        }
        return c;
      });
      return { ...track, clips: [...shifted, placedClip] };
    }),
  };

  return newTimeline;
}

/** Get all clip IDs whose bounding boxes intersect the given rectangle (in content-space pixels) */
export function getClipIdsInRect(
  timeline: TimelineProject,
  rect: { x: number; y: number; width: number; height: number },
  pixelsPerSec: number,
): Set<string> {
  const result = new Set<string>();
  const mx1 = rect.x;
  const my1 = rect.y;
  const mx2 = mx1 + rect.width;
  const my2 = my1 + rect.height;

  for (let trackIndex = 0; trackIndex < timeline.tracks.length; trackIndex++) {
    const track = timeline.tracks[trackIndex];
    const clipTop = RULER_HEIGHT + trackIndex * TRACK_HEIGHT + CLIP_PADDING;
    const clipBottom = clipTop + (TRACK_HEIGHT - CLIP_PADDING * 2);

    if (my2 < clipTop || my1 > clipBottom) continue;

    for (const clip of track.clips) {
      const clipLeft = HEADER_WIDTH + clip.timeline_start_sec * pixelsPerSec;
      const clipRight = HEADER_WIDTH + clip.timeline_end_sec * pixelsPerSec;

      if (mx2 >= clipLeft && mx1 <= clipRight) {
        result.add(clip.id);
      }
    }
  }
  return result;
}
