import type { Track } from '@mrdv2/shared';
import { TRACK_COLORS } from './timelineConstants';
import { gray500 } from '../../theme';

interface TrackHeaderProps {
  track: Track;
  onDelete: (trackId: string) => void;
  onDragStart: (trackId: string, pointerY: number) => void;
}

export default function TrackHeader({ track, onDelete, onDragStart }: TrackHeaderProps) {
  const color = TRACK_COLORS[track.type] || gray500;
  const displayName =
    track.name || track.type.charAt(0).toUpperCase() + track.type.slice(1);

  return (
    <div className="w-full h-full flex items-center gap-1 px-1 select-none">
      {/* Drag handle */}
      <div
        className="flex-shrink-0 w-4 h-5 flex items-center justify-center
                   cursor-grab text-zinc-600 hover:text-zinc-400 transition-colors"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onDragStart(track.id, e.clientY);
        }}
      >
        <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
          <circle cx="1.5" cy="1.5" r="1" />
          <circle cx="4.5" cy="1.5" r="1" />
          <circle cx="1.5" cy="5" r="1" />
          <circle cx="4.5" cy="5" r="1" />
          <circle cx="1.5" cy="8.5" r="1" />
          <circle cx="4.5" cy="8.5" r="1" />
        </svg>
      </div>

      {/* Color bar */}
      <div
        className="w-1 h-5 rounded-sm flex-shrink-0"
        style={{ backgroundColor: color }}
      />

      {/* Track name */}
      <span className="flex-1 text-[11px] text-zinc-300 truncate">
        {displayName}
      </span>

      {/* Delete button */}
      <button
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded
                   text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60 transition-colors"
        title="Delete track"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(track.id);
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>
    </div>
  );
}
