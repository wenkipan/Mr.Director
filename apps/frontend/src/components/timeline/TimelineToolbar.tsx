import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import { findClipById, splitClipInTimeline, generateClipId, addClipToTimeline, wouldOverlap, mergeClipsInTimeline, findGapAtTime, removeGapOnTrack, removeGapAllTracks } from './timelineUtils';

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
  // ── Split ──
  const canSplit = useMemo(() => {
    if (selectedClipIds.size !== 1) return false;
    const clipId = [...selectedClipIds][0];
    const found = findClipById(timeline, clipId);
    if (!found) return false;
    const { clip } = found;
    return currentTime > clip.timeline_start_sec && currentTime < clip.timeline_end_sec;
  }, [selectedClipIds, timeline, currentTime]);

  const handleSplit = useCallback(() => {
    if (selectedClipIds.size !== 1) return;
    const clipId = [...selectedClipIds][0];
    const newTimeline = splitClipInTimeline(timeline, clipId, currentTime);
    if (newTimeline) {
      onTimelineChange(newTimeline);
    }
  }, [selectedClipIds, timeline, currentTime, onTimelineChange]);

  // ── Add Subtitle ──
  const subtitleTracks = useMemo(
    () => timeline.tracks.filter((t) => t.type === 'subtitle'),
    [timeline],
  );

  const [trackMenuOpen, setTrackMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!trackMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTrackMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [trackMenuOpen]);

  const addSubtitleToTrack = useCallback(
    (trackId: string) => {
      const track = timeline.tracks.find((t) => t.id === trackId);
      if (!track) return;
      if (wouldOverlap('', currentTime, 1, track.clips)) return;
      const clip = {
        id: generateClipId(),
        type: 'subtitle' as const,
        timeline_start_sec: currentTime,
        timeline_end_sec: currentTime + 1,
        subtitle_text: 'Subtitle',
        speed: 1,
        source_in_sec: 0,
      };
      onTimelineChange(addClipToTimeline(timeline, trackId, clip));
    },
    [timeline, currentTime, onTimelineChange],
  );

  // ── Merge ──
  const canMerge = useMemo(() => {
    if (selectedClipIds.size !== 2) return false;
    const [id1, id2] = [...selectedClipIds];
    return mergeClipsInTimeline(timeline, id1, id2) !== null;
  }, [selectedClipIds, timeline]);

  const handleMerge = useCallback(() => {
    if (selectedClipIds.size !== 2) return;
    const [id1, id2] = [...selectedClipIds];
    const newTimeline = mergeClipsInTimeline(timeline, id1, id2);
    if (newTimeline) {
      onTimelineChange(newTimeline);
    }
  }, [selectedClipIds, timeline, onTimelineChange]);

  // ── Remove Gap ──
  const [gapMenuOpen, setGapMenuOpen] = useState(false);
  const gapMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gapMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (gapMenuRef.current && !gapMenuRef.current.contains(e.target as Node)) {
        setGapMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [gapMenuOpen]);

  const gaps = useMemo(
    () => findGapAtTime(timeline, currentTime),
    [timeline, currentTime],
  );
  const canRemoveGap = gaps.length > 0;

  const handleRemoveGap = useCallback(() => {
    if (gaps.length === 0) return;
    if (gaps.length === 1) {
      const { trackId, gapStart, gapDuration } = gaps[0];
      onTimelineChange(removeGapOnTrack(timeline, trackId, gapStart, gapDuration));
    } else {
      setGapMenuOpen((v) => !v);
    }
  }, [gaps, timeline, onTimelineChange]);

  const handleRemoveGapForTrack = useCallback(
    (trackIdOrAll: string) => {
      setGapMenuOpen(false);
      if (trackIdOrAll === 'ALL') {
        onTimelineChange(removeGapAllTracks(timeline, currentTime, gaps));
      } else {
        const gap = gaps.find((g) => g.trackId === trackIdOrAll);
        if (!gap) return;
        onTimelineChange(removeGapOnTrack(timeline, gap.trackId, gap.gapStart, gap.gapDuration));
      }
    },
    [gaps, timeline, currentTime, onTimelineChange],
  );

  const handleAddSubtitle = useCallback(() => {
    if (subtitleTracks.length === 0) return;
    if (subtitleTracks.length === 1) {
      addSubtitleToTrack(subtitleTracks[0].id);
    } else {
      setTrackMenuOpen((v) => !v);
    }
  }, [subtitleTracks, addSubtitleToTrack]);

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-t border-zinc-800 bg-zinc-900">
      {/* Split */}
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

      {/* Add Subtitle */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={handleAddSubtitle}
          disabled={subtitleTracks.length === 0}
          title="Add subtitle clip at playhead"
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
            {/* Text / T icon */}
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9.5" y1="20" x2="14.5" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
          Subtitle
        </button>

        {/* Track selection dropdown */}
        {trackMenuOpen && (
          <div className="absolute bottom-full left-0 mb-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 min-w-[120px] z-50">
            {subtitleTracks.map((t) => (
              <button
                key={t.id}
                className="w-full text-left px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                onClick={() => {
                  addSubtitleToTrack(t.id);
                  setTrackMenuOpen(false);
                }}
              >
                {t.name || t.id}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Merge */}
      <button
        onClick={handleMerge}
        disabled={!canMerge}
        title="Merge two adjacent clips"
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
          {/* Merge icon: two arrows pointing inward */}
          <polyline points="6 9 12 3 18 9" />
          <line x1="12" y1="3" x2="12" y2="15" />
          <path d="M4 21h16" />
        </svg>
        Merge
      </button>

      {/* Remove Gap */}
      <div className="relative" ref={gapMenuRef}>
        <button
          onClick={handleRemoveGap}
          disabled={!canRemoveGap}
          title="Remove gap at playhead (Shift+Delete)"
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
            {/* Two inward-pointing arrows — ripple close */}
            <polyline points="18 8 22 12 18 16" />
            <polyline points="6 8 2 12 6 16" />
            <line x1="2" y1="12" x2="10" y2="12" />
            <line x1="14" y1="12" x2="22" y2="12" />
          </svg>
          Remove Gap
        </button>

        {gapMenuOpen && gaps.length > 1 && (
          <div className="absolute bottom-full left-0 mb-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 min-w-[140px] z-50">
            <button
              className="w-full text-left px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors border-b border-zinc-700"
              onClick={() => handleRemoveGapForTrack('ALL')}
            >
              All Tracks
            </button>
            {gaps.map((g) => (
              <button
                key={g.trackId}
                className="w-full text-left px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                onClick={() => handleRemoveGapForTrack(g.trackId)}
              >
                {g.trackName}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
