import { useState, useEffect } from 'react';
import type { Clip, SubtitleStyle } from '@mrdv2/shared';

interface SubtitleClipEditorProps {
  clip: Clip;
  onUpdate: (updates: Partial<Clip>) => void;
}

export default function SubtitleClipEditor({ clip, onUpdate }: SubtitleClipEditorProps) {
  const style: SubtitleStyle = clip.subtitle_style ?? {};
  const fontSize = style.font_size ?? 48;

  // Local state for text input to keep typing responsive
  const [text, setText] = useState(clip.subtitle_text ?? '');
  const [localFontSize, setLocalFontSize] = useState(fontSize);

  // Sync local state when the selected clip changes
  useEffect(() => {
    setText(clip.subtitle_text ?? '');
    setLocalFontSize(clip.subtitle_style?.font_size ?? 48);
  }, [clip.id]);

  return (
    <div className="space-y-3">
      {/* Subtitle Text */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Subtitle Text</label>
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

      {/* Font Size */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Font Size</label>
        <input
          type="number"
          value={localFontSize}
          min={8}
          max={200}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (isNaN(val)) return;
            setLocalFontSize(val);
            onUpdate({
              subtitle_style: { ...style, font_size: val },
            });
          }}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100
                     focus:outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}
