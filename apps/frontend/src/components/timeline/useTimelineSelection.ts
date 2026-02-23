import { useState, useCallback } from 'react';

export function useTimelineSelection() {
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());

  const selectClip = useCallback((clipId: string, multi: boolean) => {
    setSelectedClipIds((prev) => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(clipId)) {
          next.delete(clipId);
        } else {
          next.add(clipId);
        }
        return next;
      }
      // Single select — if already the only selection, keep it; otherwise select just this
      if (prev.size === 1 && prev.has(clipId)) return prev;
      return new Set([clipId]);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedClipIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  return { selectedClipIds, selectClip, clearSelection };
}
