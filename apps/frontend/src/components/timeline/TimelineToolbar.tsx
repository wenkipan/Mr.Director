import { useMemo, useCallback } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import { findClipById, splitClipInTimeline } from './timelineUtils';

interface TimelineToolbarProps {
  timeline: TimelineProject;
  selectedClipIds: Set<string>;
  currentTime: number; // seconds
  onTimelineChange: (newTimeline: TimelineProject) => void;
}

export default function TimelineToolbar({
  timeline,
  selectedClipIds,
  currentTime,
  onTimelineChange,
}: TimelineToolbarProps) {
  // Check if split is possible: exactly 1 clip selected and playhead is inside it
  const canSplit = useMemo(() => {
    if (selectedClipIds.size !== 1) return false;
    const clipId = [...selectedClipIds][0];
    const found = findClipById(timeline, clipId);
    if (!found) return false;
    const { clip } = found;
    const clipEnd = clip.timeline_start_sec + clip.duration_sec;
    return currentTime > clip.timeline_start_sec && currentTime < clipEnd;
  }, [selectedClipIds, timeline, currentTime]);

  const handleSplit = useCallback(() => {
    if (selectedClipIds.size !== 1) return;
    const clipId = [...selectedClipIds][0];
    const newTimeline = splitClipInTimeline(timeline, clipId, currentTime);
    if (newTimeline) {
      onTimelineChange(newTimeline);
    }
  }, [selectedClipIds, timeline, currentTime, onTimelineChange]);

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-t border-zinc-800 bg-zinc-900">
      <button
        onClick={handleSplit}
        disabled={!canSplit}
        title="Split clip at playhead (S)"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
          enabled:hover:bg-zinc-700 enabled:text-zinc-200 text-zinc-400"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Scissors icon */}
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="20" y1="4" x2="8.12" y2="15.88" />
          <line x1="14.47" y1="14.48" x2="20" y2="20" />
          <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
        Split
      </button>
    </div>
  );
}
