import { useState, useEffect } from 'react';
import type { Clip } from '@mrdv2/shared';

interface VolumeControlProps {
  clip: Clip;
  onVolumeChange: (volume: number) => void;
}

const PRESETS = [0, 0.5, 1, 1.5, 2];

export default function VolumeControl({ clip, onVolumeChange }: VolumeControlProps) {
  const volume = clip.volume ?? 1;
  const [local, setLocal] = useState(volume);

  useEffect(() => {
    setLocal(volume);
  }, [volume]);

  const handleChange = (val: number) => {
    const clamped = Math.max(0, Math.min(2, val));
    setLocal(clamped);
    onVolumeChange(clamped);
  };

  return (
    <fieldset>
      <legend className="text-xs font-medium text-zinc-300 mb-2">Volume</legend>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="range"
            value={local}
            min={0}
            max={2}
            step={0.05}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) handleChange(val);
            }}
            className="flex-1 h-1 accent-blue-500 bg-zinc-700 rounded-full cursor-pointer"
          />
          <span className="text-xs text-zinc-400 w-8 text-right tabular-nums">
            {local.toFixed(1)}
          </span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => handleChange(v)}
              className={`px-2 py-0.5 text-xs rounded ${
                Math.abs(volume - v) < 0.001
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {v === 0 ? 'Mute' : `${v}x`}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
