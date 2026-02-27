import { useRef, useCallback, useEffect } from 'react';
import { useSelectionStore } from '../../stores/selectionStore';
import { useAppStore } from '../../stores/appStore';
import { findClipById, updateClipInTimeline } from '../timeline/timelineUtils';
import SubtitleClipEditor from './editors/SubtitleClipEditor';
import VideoClipEditor from './editors/VideoClipEditor';
import type { Clip, TimelineProject } from '@mrdv2/shared';

export default function ClipPropertiesEditor() {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds);
  const timeline = useAppStore((s) => s.timeline);
  const updateTimeline = useAppStore((s) => s.updateTimeline);
  const setTimelineSilent = useAppStore((s) => s.setTimelineSilent);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Snapshot of timeline before the current editing "session" for undo
  const undoSnapshotRef = useRef<TimelineProject | null>(null);

  // Clear stale selections when the selected clip disappears from timeline
  useEffect(() => {
    if (!timeline || selectedClipIds.size === 0) return;
    const clearSelection = useSelectionStore.getState().clearSelection;
    for (const id of selectedClipIds) {
      if (!findClipById(timeline, id)) {
        clearSelection();
        break;
      }
    }
  }, [timeline, selectedClipIds]);

  const handleClipUpdate = useCallback(
    (updates: Partial<Clip>) => {
      if (!timeline || selectedClipIds.size !== 1) return;
      const clipId = [...selectedClipIds][0];

      // Capture undo snapshot at the start of an editing session
      if (!undoSnapshotRef.current) {
        undoSnapshotRef.current = timeline;
      }

      const newTimeline = updateClipInTimeline(timeline, clipId, updates);

      // Immediately update for visual feedback (no undo push)
      setTimelineSilent(newTimeline);

      // Debounce: commit to undo stack after 500ms of inactivity
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Push the pre-edit snapshot to undo, then set current as the new state
        const snapshot = undoSnapshotRef.current;
        undoSnapshotRef.current = null;
        if (snapshot) {
          const { undoStack } = useAppStore.getState();
          const current = useAppStore.getState().timeline;
          useAppStore.setState({
            undoStack: [...undoStack, snapshot].slice(-50),
            redoStack: [],
            timeline: current,
            timelineDirty: true,
          });
        }
      }, 500);
    },
    [timeline, selectedClipIds, setTimelineSilent],
  );

  // Empty state: no selection
  if (!timeline || selectedClipIds.size === 0) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          Select a clip to edit properties
        </div>
      </div>
    );
  }

  // Multi-selection: no editing
  if (selectedClipIds.size > 1) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          Select a single clip to edit
        </div>
      </div>
    );
  }

  const clipId = [...selectedClipIds][0];
  const found = findClipById(timeline, clipId);

  if (!found) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          Clip not found
        </div>
      </div>
    );
  }

  const { clip } = found;

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
        Properties — <span className="text-zinc-300 capitalize">{clip.type}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {clip.type === 'subtitle' && (
          <SubtitleClipEditor clip={clip} onUpdate={handleClipUpdate} />
        )}
        {clip.type === 'video' && (
          <VideoClipEditor clip={clip} onUpdate={handleClipUpdate} />
        )}
        {clip.type === 'audio' && (
          <div className="text-zinc-500 text-xs">No editable properties for audio clips.</div>
        )}
        {clip.type === 'text' && (
          <div className="text-zinc-500 text-xs">No editable properties for text clips.</div>
        )}
      </div>
    </div>
  );
}
