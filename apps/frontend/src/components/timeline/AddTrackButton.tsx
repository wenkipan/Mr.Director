import { useState, useRef, useEffect } from 'react';
import { TRACK_COLORS } from './timelineConstants';

type TrackType = 'video' | 'audio' | 'subtitle' | 'text';

interface AddTrackButtonProps {
  onAddTrack: (type: TrackType) => void;
}

const options: { type: TrackType; label: string }[] = [
  { type: 'video', label: 'Video Track' },
  { type: 'audio', label: 'Audio Track' },
  { type: 'subtitle', label: 'Subtitle Track' },
  { type: 'text', label: 'Text Track' },
];

export default function AddTrackButton({ onAddTrack }: AddTrackButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center px-1">
      <button
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-zinc-500
                   hover:text-zinc-300 hover:bg-zinc-700/50 rounded transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <line x1="5" y1="1" x2="5" y2="9" />
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
        Add Track
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 min-w-[140px]
                     bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50 py-1"
        >
          {options.map(({ type, label }) => (
            <button
              key={type}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px]
                         text-zinc-300 hover:bg-zinc-700 transition-colors text-left"
              onClick={() => {
                onAddTrack(type);
                setOpen(false);
              }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: TRACK_COLORS[type] }}
              />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
