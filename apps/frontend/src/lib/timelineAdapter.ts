import type { TimelineProject, Track, Clip } from '@mrdv2/shared';

const API_BASE = '/api';

/**
 * Resolve a clip's media_id to a full API URL using the media_pool.
 * In SSR mode (Remotion render), the backend rewrites paths to full HTTP URLs
 * pointing to the backend's media endpoint, so we return them directly.
 */
export function resolveMediaUrl(mediaId: string, timeline: TimelineProject): string {
  const asset = timeline.media_pool?.find((m) => m.id === mediaId);
  if (!asset) {
    console.warn(`Media asset not found: ${mediaId}`);
    return '';
  }
  // SSR mode: paths are already full HTTP URLs set by the backend
  if ((timeline as any)._ssr) {
    return asset.path;
  }
  return `${API_BASE}/media/file?path=${encodeURIComponent(asset.path)}`;
}

export function getMediaType(mediaId: string, timeline: TimelineProject): string | undefined {
  return timeline.media_pool?.find((m) => m.id === mediaId)?.type;
}

/**
 * Calculate total duration in frames from all clips across all tracks.
 */
export function calculateTotalFrames(timeline: TimelineProject): number {
  const fps = timeline.project.fps;
  let maxEnd = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timeline_end_sec;
      if (clipEnd > maxEnd) maxEnd = clipEnd;
    }
  }
  // Minimum 1 second duration
  return Math.max(Math.ceil(maxEnd * fps), Math.ceil(fps));
}

/**
 * Convert Timeline JSON tracks to react-timeline-editor format.
 */
export function timelineToEditorData(timeline: TimelineProject) {
  return timeline.tracks.map((track) => ({
    id: track.id,
    name: track.name || `${track.type} track`,
    type: track.type,
    actions: track.clips.map((clip) => ({
      id: clip.id,
      start: clip.timeline_start_sec,
      end: clip.timeline_end_sec,
      effectId: `${track.type}_effect`,
      data: { clip, trackType: track.type },
    })),
  }));
}
