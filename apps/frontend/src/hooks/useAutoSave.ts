import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { updateTimeline } from '../lib/api';

/**
 * Auto-saves timeline to backend with debounce when timelineDirty is true.
 * Skips saving while the agent is active to avoid overwriting agent changes.
 * Handles 409 (agent active on server side) gracefully.
 */
export function useAutoSave(debounceMs: number = 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { timeline, projectId, timelineDirty, setTimelineDirty } = useAppStore();

  useEffect(() => {
    if (!timelineDirty || !projectId || !timeline) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      updateTimeline(projectId, timeline)
        .then((res) => {
          setTimelineDirty(false);
          // Update version from server response
          if (res?.version) {
            useAppStore.setState({ timelineVersion: res.version });
          }
        })
        .catch((e) => {
          if ((e as any).status === 409) {
            // Agent is active on server — skip, will retry after agent finishes
            console.warn('Auto-save skipped: agent is active');
          } else {
            console.error('Auto-save failed:', e);
          }
        });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timelineDirty, timeline, projectId, debounceMs, setTimelineDirty]);
}
