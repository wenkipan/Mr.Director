import { useState, useEffect } from 'react';
import type { Clip } from '@mrdv2/shared';

interface FadeControlProps {
  clip: Clip;
  onFadeChange: (fadeIn: number, fadeOut: number) => void;
}

const PRESETS = [0, 0.5, 1, 2, 3];

function FadeRow({
  label,
  value,
  propValue,
  maxFade,
  onChange,
}: {
  label: string;
  value: number;
  propValue: number;
  maxFade: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          value={value}
          min={0}
          max={Math.min(maxFade, 10)}
          step={0.1}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) onChange(val);
          }}
          className="flex-1 h-1 accent-blue-500 bg-zinc-700 rounded-full cursor-pointer"
        />
        <span className="text-xs text-zinc-400 w-8 text-right tabular-nums">
          {value.toFixed(1)}s
        </span>
      </div>
      <div className="flex gap-1 flex-wrap mt-1">
        {PRESETS.filter((v) => v <= maxFade).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`px-2 py-0.5 text-xs rounded ${
              Math.abs(propValue - v) < 0.05
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {v === 0 ? 'Off' : `${v}s`}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FadeControl({ clip, onFadeChange }: FadeControlProps) {
  const fadeIn = clip.fade_in_sec ?? 0;
  const fadeOut = clip.fade_out_sec ?? 0;
  const [localIn, setLocalIn] = useState(fadeIn);
  const [localOut, setLocalOut] = useState(fadeOut);

  const clipDuration = clip.timeline_end_sec - clip.timeline_start_sec;
  const maxFade = Math.max(0, clipDuration / 2);

  useEffect(() => { setLocalIn(fadeIn); }, [fadeIn]);
  useEffect(() => { setLocalOut(fadeOut); }, [fadeOut]);

  const handleChange = (which: 'in' | 'out', val: number) => {
    const clamped = Math.max(0, Math.min(maxFade, val));
    if (which === 'in') {
      setLocalIn(clamped);
      onFadeChange(clamped, localOut);
    } else {
      setLocalOut(clamped);
      onFadeChange(localIn, clamped);
    }
  };

  return (
    <fieldset>
      <legend className="text-xs font-medium text-zinc-300 mb-2">Fade</legend>
      <div className="space-y-3">
        <FadeRow label="Fade In" value={localIn} propValue={fadeIn} maxFade={maxFade} onChange={(v) => handleChange('in', v)} />
        <FadeRow label="Fade Out" value={localOut} propValue={fadeOut} maxFade={maxFade} onChange={(v) => handleChange('out', v)} />
      </div>
    </fieldset>
  );
}
