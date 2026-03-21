import { useEffect, useRef } from 'react';
import { prefetch } from 'remotion';
import type { TimelineProject } from '@mrdv2/shared';
import { resolveMediaUrl } from '../lib/timelineAdapter';

/**
 * Prefetch all media_pool assets so that Remotion <Video>/<Audio> components
 * can use the cached blob URLs instead of fetching from the backend on every
 * timeline change. This eliminates the delay after editing clips.
 */
export function useMediaPrefetch(timeline: TimelineProject | null) {
  // Track active prefetch handles keyed by media URL
  const prefetchedRef = useRef<Map<string, { free: () => void }>>(new Map());

  useEffect(() => {
    if (!timeline) return;

    const currentUrls = new Set<string>();

    for (const asset of timeline.media_pool) {
      const url = resolveMediaUrl(asset.id, timeline);
      if (!url) continue;
      currentUrls.add(url);

      // Skip if already prefetched
      if (prefetchedRef.current.has(url)) continue;

      const contentType =
        asset.type === 'audio'
          ? 'audio/mpeg'
          : asset.type === 'image'
            ? (asset.path.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png')
            : 'video/mp4';

      try {
        const handle = prefetch(url, {
          method: 'blob-url',
          contentType,
        });
        prefetchedRef.current.set(url, handle);
      } catch (err) {
        console.warn('Media prefetch failed:', url, err);
      }
    }

    // Free any prefetched URLs no longer in the media pool
    for (const [url, handle] of prefetchedRef.current) {
      if (!currentUrls.has(url)) {
        handle.free();
        prefetchedRef.current.delete(url);
      }
    }
  }, [timeline]);

  // Cleanup all prefetch handles on unmount
  useEffect(() => {
    const ref = prefetchedRef.current;
    return () => {
      for (const handle of ref.values()) {
        handle.free();
      }
      ref.clear();
    };
  }, []);
}
