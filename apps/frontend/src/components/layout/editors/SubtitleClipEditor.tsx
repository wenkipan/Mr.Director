import { useState, useEffect, useCallback } from 'react';
import type { Clip, SubtitleStyle } from '@mrdv2/shared';

interface SubtitleClipEditorProps {
  clip: Clip;
  onUpdate: (updates: Partial<Clip>) => void;
}

export default function SubtitleClipEditor({ clip, onUpdate }: SubtitleClipEditorProps) {
  const style: SubtitleStyle = clip.subtitle_style ?? {};

  const [text, setText] = useState(clip.subtitle_text ?? '');
  const [localFontSize, setLocalFontSize] = useState(style.font_size ?? 48);

  useEffect(() => {
    setText(clip.subtitle_text ?? '');
    setLocalFontSize(clip.subtitle_style?.font_size ?? 48);
  }, [clip.id]);

  const handleStyleChange = useCallback(
    (key: keyof SubtitleStyle, value: number | string | boolean) => {
      onUpdate({
        subtitle_style: { ...style, [key]: value },
      });
    },
    [style, onUpdate],
  );

  return (
    <div className="space-y-3">
      {/* Text Content */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Text</label>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onUpdate({ subtitle_text: e.target.value });
          }}
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100
                     focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {/* Position */}
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-zinc-500 font-medium">Position</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-zinc-500">X</label>
            <input
              type="number"
              value={style.position_x ?? 0.5}
              min={0} max={1} step={0.01}
              onChange={(e) => handleStyleChange('position_x', parseFloat(e.target.value) || 0.5)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100
                         focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500">Y</label>
            <input
              type="number"
              value={style.position_y ?? 0.85}
              min={0} max={1} step={0.01}
              onChange={(e) => handleStyleChange('position_y', parseFloat(e.target.value) || 0.85)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100
                         focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </fieldset>

      {/* Typography */}
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-zinc-500 font-medium">Typography</legend>
        <div>
          <label className="block text-[10px] text-zinc-500">Font Size</label>
          <input
            type="number"
            value={localFontSize}
            min={8} max={200}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (isNaN(val)) return;
              setLocalFontSize(val);
              handleStyleChange('font_size', val);
            }}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100
                       focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500">Color</label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={style.color ?? '#FFFFFF'}
              onChange={(e) => handleStyleChange('color', e.target.value)}
              className="w-6 h-6 bg-transparent border border-zinc-700 rounded cursor-pointer"
            />
            <span className="text-[10px] text-zinc-400">{style.color ?? '#FFFFFF'}</span>
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500">Align</label>
          <select
            value={style.text_align ?? 'center'}
            onChange={(e) => handleStyleChange('text_align', e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100
                       focus:outline-none focus:border-blue-500"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={style.bold ?? false}
              onChange={(e) => handleStyleChange('bold', e.target.checked)}
              className="rounded border-zinc-600"
            />
            Bold
          </label>
          <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={style.italic ?? false}
              onChange={(e) => handleStyleChange('italic', e.target.checked)}
              className="rounded border-zinc-600"
            />
            Italic
          </label>
        </div>
      </fieldset>

      {/* Background */}
      <div>
        <label className="block text-[10px] text-zinc-500">Background</label>
        <input
          type="text"
          value={style.background ?? 'rgba(0,0,0,0.6)'}
          onChange={(e) => handleStyleChange('background', e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100
                     focus:outline-none focus:border-blue-500"
          placeholder="rgba(0,0,0,0.6) or transparent"
        />
      </div>
    </div>
  );
}
