import { useState, useEffect, useCallback } from 'react';
import type { Clip, SubtitleStyle } from '@mrdv2/shared';
import { resolveSubtitleStyle } from '@mrdv2/shared';
import { useAppStore } from '../../../stores/appStore';
import PresetPopover from './PresetPopover';
import ColorSwatch from './ColorSwatch';

interface SubtitleClipEditorProps {
  clip: Clip;
  onUpdate: (updates: Partial<Clip>) => void;
  batchMode?: boolean;
}

/* Reset icon — shown when a field has a per-clip override */
const IconReset = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className="flex-shrink-0">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

/** Check if a specific style key is overridden on this clip */
function hasOverride(override: SubtitleStyle | undefined | null, key: keyof SubtitleStyle): boolean {
  return override != null && override[key] !== undefined && override[key] !== null;
}

export default function SubtitleClipEditor({ clip, onUpdate, batchMode }: SubtitleClipEditorProps) {
  const subtitlePresets = useAppStore((s) => s.subtitlePresets);

  const presetName = clip.subtitle_style_ref ?? 'default';
  const preset = subtitlePresets[presetName] ?? {};
  const override = clip.subtitle_style ?? {};
  const resolved = resolveSubtitleStyle(preset, override);

  const [text, setText] = useState(clip.subtitle_text ?? '');
  const [localFontSize, setLocalFontSize] = useState(resolved.font_size);

  useEffect(() => {
    setText(clip.subtitle_text ?? '');
    setLocalFontSize(resolved.font_size);
  }, [clip.id]);

  const handleStyleChange = useCallback(
    (key: keyof SubtitleStyle, value: number | string | boolean) => {
      onUpdate({
        subtitle_style: { ...override, [key]: value },
      });
    },
    [override, onUpdate],
  );

  const handlePresetChange = useCallback(
    (name: string) => {
      onUpdate({ subtitle_style_ref: name, subtitle_style: undefined });
    },
    [onUpdate],
  );

  /** Reset a single override field back to preset value */
  const resetField = useCallback(
    (key: keyof SubtitleStyle) => {
      const newOverride = { ...override };
      delete newOverride[key];
      const isEmpty = Object.values(newOverride).every((v) => v === undefined);
      onUpdate({ subtitle_style: isEmpty ? undefined : newOverride });
    },
    [override, onUpdate],
  );

  /** Shared classes for input styling + override indicator */
  const inputCls = (key: keyof SubtitleStyle) =>
    `w-full bg-zinc-800 border rounded px-2 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 ${
      hasOverride(clip.subtitle_style, key) ? 'border-blue-500/50' : 'border-zinc-700'
    }`;

  /** Wrapper: label + optional reset button */
  const FieldRow = ({ label, fieldKey, children }: { label: string; fieldKey: keyof SubtitleStyle; children: React.ReactNode }) => (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="block text-[10px] text-zinc-500">{label}</label>
        {hasOverride(clip.subtitle_style, fieldKey) && (
          <button
            onClick={() => resetField(fieldKey)}
            className="text-blue-400 hover:text-blue-300 transition-colors"
            title="Reset to preset value"
          >
            <IconReset />
          </button>
        )}
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Preset Selector (popover) */}
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-zinc-500 font-medium">Style Preset</legend>
        <PresetPopover currentPreset={presetName} onSelectPreset={handlePresetChange} />
      </fieldset>

      {/* Text Content (hidden in batch mode) */}
      {!batchMode && (
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
      )}

      {/* ── Clip Overrides ────────────────────────────────── */}
      <div className="border-t border-zinc-700 pt-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500 font-medium">Clip Overrides</span>
          {clip.subtitle_style && Object.keys(clip.subtitle_style).length > 0 && (
            <button
              onClick={() => onUpdate({ subtitle_style: undefined })}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              Reset all
            </button>
          )}
        </div>

        <div className="space-y-2">
          {/* Position */}
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Position</legend>
            <div className="grid grid-cols-2 gap-2">
              <FieldRow label="X" fieldKey="position_x">
                <input type="number" value={resolved.position_x} min={0} max={1} step={0.01}
                  onChange={(e) => handleStyleChange('position_x', parseFloat(e.target.value) || 0.5)}
                  className={inputCls('position_x')} />
              </FieldRow>
              <FieldRow label="Y" fieldKey="position_y">
                <input type="number" value={resolved.position_y} min={0} max={1} step={0.01}
                  onChange={(e) => handleStyleChange('position_y', parseFloat(e.target.value) || 0.85)}
                  className={inputCls('position_y')} />
              </FieldRow>
            </div>
          </fieldset>

          {/* Typography */}
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Typography</legend>
            <FieldRow label="Font Size" fieldKey="font_size">
              <input type="number" value={localFontSize} min={8} max={200}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (isNaN(val)) return;
                  setLocalFontSize(val);
                  handleStyleChange('font_size', val);
                }}
                className={inputCls('font_size')} />
            </FieldRow>
            <FieldRow label="Color" fieldKey="color">
              <ColorSwatch value={resolved.color} onChange={(c) => handleStyleChange('color', c)} />
            </FieldRow>
            <FieldRow label="Align" fieldKey="text_align">
              <select value={resolved.text_align}
                onChange={(e) => handleStyleChange('text_align', e.target.value)}
                className={inputCls('text_align')}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </FieldRow>
            <div className="flex gap-3">
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={resolved.bold}
                    onChange={(e) => handleStyleChange('bold', e.target.checked)}
                    className="rounded border-zinc-600" />
                  Bold
                </label>
                {hasOverride(clip.subtitle_style, 'bold') && (
                  <button onClick={() => resetField('bold')} className="text-blue-400 hover:text-blue-300"><IconReset /></button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={resolved.italic}
                    onChange={(e) => handleStyleChange('italic', e.target.checked)}
                    className="rounded border-zinc-600" />
                  Italic
                </label>
                {hasOverride(clip.subtitle_style, 'italic') && (
                  <button onClick={() => resetField('italic')} className="text-blue-400 hover:text-blue-300"><IconReset /></button>
                )}
              </div>
            </div>
            <FieldRow label="Letter Spacing (px)" fieldKey="letter_spacing">
              <input type="number" value={resolved.letter_spacing} step={0.5}
                onChange={(e) => handleStyleChange('letter_spacing', parseFloat(e.target.value) || 0)}
                className={inputCls('letter_spacing')} />
            </FieldRow>
          </fieldset>

          {/* Appearance */}
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Appearance</legend>
            <FieldRow label="Background" fieldKey="background">
              <input type="text" value={resolved.background}
                onChange={(e) => handleStyleChange('background', e.target.value)}
                placeholder="rgba(0,0,0,0.6) or transparent"
                className={inputCls('background')} />
            </FieldRow>
            <FieldRow label="Padding" fieldKey="padding">
              <input type="text" value={resolved.padding}
                onChange={(e) => handleStyleChange('padding', e.target.value)}
                placeholder="4px 16px"
                className={inputCls('padding')} />
            </FieldRow>
            <div className="grid grid-cols-2 gap-2">
              <FieldRow label="Border Radius (px)" fieldKey="border_radius">
                <input type="number" value={resolved.border_radius} min={0}
                  onChange={(e) => handleStyleChange('border_radius', parseFloat(e.target.value) || 0)}
                  className={inputCls('border_radius')} />
              </FieldRow>
              <FieldRow label="Opacity" fieldKey="opacity">
                <input type="number" value={resolved.opacity} min={0} max={1} step={0.05}
                  onChange={(e) => handleStyleChange('opacity', parseFloat(e.target.value) || 1)}
                  className={inputCls('opacity')} />
              </FieldRow>
            </div>
          </fieldset>

          {/* Outline & Shadow */}
          <fieldset className="space-y-1.5">
            <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Outline & Shadow</legend>
            <div className="grid grid-cols-2 gap-2">
              <FieldRow label="Outline Color" fieldKey="outline_color">
                <ColorSwatch value={resolved.outline_color} onChange={(c) => handleStyleChange('outline_color', c)} allowTransparent />
              </FieldRow>
              <FieldRow label="Outline Width" fieldKey="outline_width">
                <input type="number" value={resolved.outline_width} min={0} step={0.5}
                  onChange={(e) => handleStyleChange('outline_width', parseFloat(e.target.value) || 0)}
                  className={inputCls('outline_width')} />
              </FieldRow>
            </div>
            <FieldRow label="Shadow (CSS text-shadow)" fieldKey="shadow">
              <input type="text"
                value={resolved.shadow === 'none' ? '' : resolved.shadow}
                onChange={(e) => handleStyleChange('shadow', e.target.value || 'none')}
                placeholder="2px 2px 4px rgba(0,0,0,0.5)"
                className={inputCls('shadow')} />
            </FieldRow>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
