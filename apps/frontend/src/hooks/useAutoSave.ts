import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { updateTimeline } from '../lib/api';

/**
 * Auto-saves timeline to backend with debounce when timelineDirty is true.
 */
export function useAutoSave(debounceMs: number = 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { timeline, projectId, timelineDirty, setTimelineDirty } = useAppStore();

  useEffect(() => {
    if (!timelineDirty || !projectId || !timeline) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      updateTimeline(projectId, timeline)
        .then(() => setTimelineDirty(false))
        .catch((e) => console.error('Auto-save failed:', e));
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timelineDirty, timeline, projectId, debounceMs, setTimelineDirty]);
}
