import { useState, useRef, useEffect } from 'react';

/** Predefined colors commonly used for subtitles */
const PRESET_COLORS = [
  '#FFFFFF', '#000000', '#FFFF00', '#00FF00',
  '#00FFFF', '#FF0000', '#FF00FF', '#0000FF',
  '#FFA500', '#FFD700', '#90EE90', '#ADD8E6',
  '#FFC0CB', '#808080', '#C0C0C0', '#800000',
];

interface ColorSwatchProps {
  value: string;
  onChange: (color: string) => void;
  /** Show a "transparent" option (for outline color etc.) */
  allowTransparent?: boolean;
}

export default function ColorSwatch({ value, onChange, allowTransparent }: ColorSwatchProps) {
  const [expanded, setExpanded] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync hex input when external value changes
  useEffect(() => { setHexInput(value); }, [value]);

  // Click outside to close
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expanded]);

  const isTransparent = value === 'transparent';

  const handleHexCommit = () => {
    const v = hexInput.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
      onChange(v);
    } else {
      setHexInput(value); // revert
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger: current color swatch + hex label */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex gap-1.5 items-center group"
      >
        <span
          className="w-5 h-5 rounded border border-zinc-600 flex-shrink-0 cursor-pointer"
          style={{
            background: isTransparent
              ? 'repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 8px 8px'
              : value,
          }}
        />
        <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200 transition-colors truncate max-w-[72px]">
          {value}
        </span>
      </button>

      {/* Dropdown panel */}
      {expanded && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 w-[156px]">
          {/* Swatch grid */}
          <div className="grid grid-cols-8 gap-1 mb-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setExpanded(false); }}
                className={`w-4 h-4 rounded-sm border cursor-pointer transition-transform hover:scale-125 ${
                  value === c ? 'border-blue-400 ring-1 ring-blue-400' : 'border-zinc-600'
                }`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>

          {/* Transparent option */}
          {allowTransparent && (
            <button
              type="button"
              onClick={() => { onChange('transparent'); setExpanded(false); }}
              className={`w-full text-[10px] text-left px-1.5 py-0.5 rounded mb-1.5 transition-colors ${
                isTransparent ? 'bg-blue-600/20 text-blue-300' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              transparent
            </button>
          )}

          {/* Hex input */}
          <div className="flex gap-1 items-center">
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={handleHexCommit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleHexCommit(); }}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100
                         focus:outline-none focus:border-blue-500 font-mono"
              placeholder="#FFFFFF"
            />
            {/* Native picker as fallback */}
            <input
              type="color"
              value={isTransparent ? '#000000' : value}
              onChange={(e) => { onChange(e.target.value); }}
              className="w-5 h-5 bg-transparent border border-zinc-700 rounded cursor-pointer flex-shrink-0"
              title="Custom color"
            />
          </div>
        </div>
      )}
    </div>
  );
}
