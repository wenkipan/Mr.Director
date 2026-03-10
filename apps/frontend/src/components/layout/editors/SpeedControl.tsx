import { useState, useEffect } from 'react';
import type { Clip } from '@mrdv2/shared';

interface SpeedControlProps {
  clip: Clip;
  onSpeedChange: (speed: number) => void;
}

const PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];

export default function SpeedControl({ clip, onSpeedChange }: SpeedControlProps) {
  const speed = clip.speed ?? 1;
  const [local, setLocal] = useState(speed);

  useEffect(() => {
    setLocal(speed);
  }, [speed]);

  const handleChange = (val: number) => {
    const clamped = Math.max(0.1, Math.min(16, val));
    setLocal(clamped);
    onSpeedChange(clamped);
  };

  return (
    <fieldset>
      <legend className="text-xs font-medium text-zinc-300 mb-2">Speed</legend>
      <div className="space-y-2">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Playback Speed</label>
          <input
            type="number"
            value={local}
            min={0.1}
            max={16}
            step={0.1}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) handleChange(val);
            }}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100
                       focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleChange(s)}
              className={`px-2 py-0.5 text-xs rounded ${
                Math.abs(speed - s) < 0.001
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
