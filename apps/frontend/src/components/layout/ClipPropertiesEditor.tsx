import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useSelectionStore } from '../../stores/selectionStore';
import { useAppStore } from '../../stores/appStore';
import { findClipById, updateClipInTimeline, updateClipsInTimeline } from '../timeline/timelineUtils';
import SubtitleClipEditor from './editors/SubtitleClipEditor';
import VideoClipEditor from './editors/VideoClipEditor';
import SpeedControl from './editors/SpeedControl';
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

  // Resolve selected clips and determine batch state
  const { selectedClips, clipType, isBatch, isSameType } = useMemo(() => {
    if (!timeline || selectedClipIds.size === 0) {
      return { selectedClips: [], clipType: null, isBatch: false, isSameType: false };
    }
    const clips = [...selectedClipIds]
      .map((id) => findClipById(timeline, id))
      .filter(Boolean) as { clip: Clip; trackIndex: number; trackId: string }[];
    const types = new Set(clips.map((f) => f.clip.type));
    return {
      selectedClips: clips,
      clipType: types.size === 1 ? [...types][0] : null,
      isBatch: selectedClipIds.size > 1,
      isSameType: types.size === 1,
    };
  }, [timeline, selectedClipIds]);

  const handleClipUpdate = useCallback(
    (updates: Partial<Clip>) => {
      if (!timeline || selectedClipIds.size === 0) return;

      // Speed change: only allowed for single clip (collision logic)
      if (updates.speed !== undefined && selectedClipIds.size > 1) return;

      // Speed change: recompute timeline_end_sec and clamp to avoid overlap
      if (updates.speed !== undefined && selectedClipIds.size === 1) {
        const clipId = [...selectedClipIds][0];
        const found = findClipById(timeline, clipId);
        if (found) {
          const { clip } = found;
          const sourceIn = clip.source_in_sec ?? 0;
          const sourceOut = clip.source_out_sec;
          if (sourceOut != null) {
            let newSpeed = updates.speed;
            let newEnd = clip.timeline_start_sec + (sourceOut - sourceIn) / newSpeed;

            // Collision check: find next clip on same track
            const track = timeline.tracks[found.trackIndex];
            const nextClip = track.clips
              .filter((c) => c.id !== clipId && c.timeline_start_sec >= clip.timeline_end_sec)
              .sort((a, b) => a.timeline_start_sec - b.timeline_start_sec)[0];

            if (nextClip && newEnd > nextClip.timeline_start_sec) {
              const maxDuration = nextClip.timeline_start_sec - clip.timeline_start_sec;
              newSpeed = (sourceOut - sourceIn) / maxDuration;
              newSpeed = Math.ceil(newSpeed * 100) / 100; // round up to avoid float overlap
              newEnd = clip.timeline_start_sec + (sourceOut - sourceIn) / newSpeed;
            }

            updates = { ...updates, speed: newSpeed, timeline_end_sec: newEnd };
          }
        }
      }

      // Capture undo snapshot at the start of an editing session
      if (!undoSnapshotRef.current) {
        undoSnapshotRef.current = timeline;
      }

      const newTimeline = selectedClipIds.size === 1
        ? updateClipInTimeline(timeline, [...selectedClipIds][0], updates)
        : updateClipsInTimeline(timeline, selectedClipIds, updates);

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

  // Multi-selection with mixed types
  if (isBatch && !isSameType) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          Select clips of the same type to batch edit
        </div>
      </div>
    );
  }

  // Batch audio — only speed, not supported in batch mode
  if (isBatch && clipType === 'audio') {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
          Properties — <span className="text-zinc-300">Audio ({selectedClipIds.size} clips)</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          Audio clips do not support batch style editing
        </div>
      </div>
    );
  }

  // Get the representative clip (first selected) for displaying values
  const representativeClip = selectedClips[0]?.clip;
  if (!representativeClip) {
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

  const headerLabel = isBatch
    ? <>{clipType} <span className="text-zinc-500">({selectedClipIds.size} clips)</span></>
    : clipType;

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
        Properties — <span className="text-zinc-300 capitalize">{headerLabel}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {clipType === 'subtitle' && (
          <SubtitleClipEditor clip={representativeClip} onUpdate={handleClipUpdate} batchMode={isBatch} />
        )}
        {clipType === 'video' && (
          <VideoClipEditor clip={representativeClip} onUpdate={handleClipUpdate} batchMode={isBatch} />
        )}
        {clipType === 'audio' && !isBatch && representativeClip.source_in_sec != null && representativeClip.source_out_sec != null && (
          <SpeedControl clip={representativeClip} onSpeedChange={(v) => handleClipUpdate({ speed: v })} />
        )}
      </div>
    </div>
  );
}
