import { useState, useRef, useEffect, useCallback } from 'react';
import type { SubtitleStyle, FontCategory } from '@mrdv2/shared';
import { DEFAULT_SUBTITLE_STYLE, SUPPORTED_FONTS } from '@mrdv2/shared';
import { ensureFontLoaded } from '../../../lib/fontLoader';
import { useAppStore } from '../../../stores/appStore';
import { upsertSubtitlePreset, deleteSubtitlePreset } from '../../../lib/api';
import ColorSwatch from './ColorSwatch';

interface PresetPopoverProps {
  currentPreset: string;
  onSelectPreset: (name: string) => void;
}

/* ── Inline SVG icons (keep bundle small) ───────────────── */
const IconPencil = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);
const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);
const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);
const IconChevron = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const IconBack = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

/* ── Style editor form (reused for edit & create) ───────── */
function StyleForm({
  style,
  onChange,
}: {
  style: Required<SubtitleStyle>;
  onChange: (key: keyof SubtitleStyle, value: number | string | boolean) => void;
}) {
  return (
    <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1 custom-scroll">
      {/* Position */}
      <fieldset className="space-y-1">
        <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Position</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-zinc-500">
            X
            <input type="number" value={style.position_x} min={0} max={1} step={0.01}
              onChange={(e) => onChange('position_x', parseFloat(e.target.value) || 0.5)}
              className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
          </label>
          <label className="text-[10px] text-zinc-500">
            Y
            <input type="number" value={style.position_y} min={0} max={1} step={0.01}
              onChange={(e) => onChange('position_y', parseFloat(e.target.value) || 0.85)}
              className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
          </label>
        </div>
      </fieldset>

      {/* Typography */}
      <fieldset className="space-y-1">
        <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Typography</legend>
        <label className="text-[10px] text-zinc-500">
          Font Family
          <select value={style.font_family}
            onChange={(e) => { onChange('font_family', e.target.value); ensureFontLoaded(e.target.value); }}
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500">
            {(['sans-serif', 'serif', 'monospace', 'display', 'cjk'] as FontCategory[]).map((cat) => {
              const fonts = SUPPORTED_FONTS.filter((f) => f.category === cat);
              if (!fonts.length) return null;
              return (
                <optgroup key={cat} label={cat.toUpperCase()}>
                  {fonts.map((f) => (
                    <option key={f.id} value={f.id}>{f.displayName}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        <label className="text-[10px] text-zinc-500">
          Font Size
          <input type="number" value={style.font_size} min={8} max={200}
            onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) onChange('font_size', v); }}
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
        </label>
        <label className="text-[10px] text-zinc-500">
          Color
          <div className="mt-0.5">
            <ColorSwatch value={style.color} onChange={(c) => onChange('color', c)} />
          </div>
        </label>
        <label className="text-[10px] text-zinc-500">
          Align
          <select value={style.text_align}
            onChange={(e) => onChange('text_align', e.target.value)}
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <div className="flex gap-3">
          <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={style.bold} onChange={(e) => onChange('bold', e.target.checked)} className="rounded border-zinc-600" />
            Bold
          </label>
          <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={style.italic} onChange={(e) => onChange('italic', e.target.checked)} className="rounded border-zinc-600" />
            Italic
          </label>
        </div>
        <label className="text-[10px] text-zinc-500">
          Letter Spacing (px)
          <input type="number" value={style.letter_spacing} step={0.5}
            onChange={(e) => onChange('letter_spacing', parseFloat(e.target.value) || 0)}
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
        </label>
      </fieldset>

      {/* Appearance */}
      <fieldset className="space-y-1">
        <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Appearance</legend>
        <label className="text-[10px] text-zinc-500">
          Background
          <input type="text" value={style.background}
            onChange={(e) => onChange('background', e.target.value)}
            placeholder="rgba(0,0,0,0.6)"
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
        </label>
        <label className="text-[10px] text-zinc-500">
          Padding
          <input type="text" value={style.padding}
            onChange={(e) => onChange('padding', e.target.value)}
            placeholder="4px 16px"
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-zinc-500">
            Border Radius
            <input type="number" value={style.border_radius} min={0}
              onChange={(e) => onChange('border_radius', parseFloat(e.target.value) || 0)}
              className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
          </label>
          <label className="text-[10px] text-zinc-500">
            Opacity
            <input type="number" value={style.opacity} min={0} max={1} step={0.05}
              onChange={(e) => onChange('opacity', parseFloat(e.target.value) || 1)}
              className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
          </label>
        </div>
      </fieldset>

      {/* Outline & Shadow */}
      <fieldset className="space-y-1">
        <legend className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Outline & Shadow</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-zinc-500">
            Outline Color
            <div className="mt-0.5">
              <ColorSwatch value={style.outline_color} onChange={(c) => onChange('outline_color', c)} allowTransparent />
            </div>
          </label>
          <label className="text-[10px] text-zinc-500">
            Outline Width
            <input type="number" value={style.outline_width} min={0} step={0.5}
              onChange={(e) => onChange('outline_width', parseFloat(e.target.value) || 0)}
              className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
          </label>
        </div>
        <label className="text-[10px] text-zinc-500">
          Shadow (CSS text-shadow)
          <input type="text" value={style.shadow === 'none' ? '' : style.shadow}
            onChange={(e) => onChange('shadow', e.target.value || 'none')}
            placeholder="2px 2px 4px rgba(0,0,0,0.5)"
            className="mt-0.5 w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500" />
        </label>
      </fieldset>
    </div>
  );
}

/* ── Main popover component ─────────────────────────────── */
export default function PresetPopover({ currentPreset, onSelectPreset }: PresetPopoverProps) {
  const subtitlePresets = useAppStore((s) => s.subtitlePresets);
  const loadSubtitlePresets = useAppStore((s) => s.loadSubtitlePresets);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'edit' | 'create'>('list');
  const [editingName, setEditingName] = useState('');
  const [newName, setNewName] = useState('');
  const [editStyle, setEditStyle] = useState<Required<SubtitleStyle>>({ ...DEFAULT_SUBTITLE_STYLE });

  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setMode('list');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      setMode('list');
    } else {
      setOpen(true);
      setMode('list');
    }
  };

  /* ── List actions ─────── */
  const handleSelect = (name: string) => {
    onSelectPreset(name);
    setOpen(false);
    setMode('list');
  };

  const handleEditClick = (name: string) => {
    const preset = subtitlePresets[name] ?? {};
    setEditingName(name);
    setEditStyle({ ...DEFAULT_SUBTITLE_STYLE, ...preset });
    setMode('edit');
  };

  const handleDeleteClick = async (name: string) => {
    if (name === 'default') return;
    await deleteSubtitlePreset(name);
    await loadSubtitlePresets();
    // If the deleted preset was active, switch to default
    if (currentPreset === name) {
      onSelectPreset('default');
    }
  };

  const handleCreateStart = () => {
    setNewName('');
    setEditStyle({ ...DEFAULT_SUBTITLE_STYLE });
    setMode('create');
  };

  /* ── Edit/Create actions ─ */
  const handleStyleField = useCallback(
    (key: keyof SubtitleStyle, value: number | string | boolean) => {
      setEditStyle((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const savePreset = async (name: string, style: Required<SubtitleStyle>) => {
    if (!name.trim()) return;
    await upsertSubtitlePreset(name.trim(), style);
    await loadSubtitlePresets();
  };

  const handleSaveAndBack = async () => {
    if (mode === 'edit') {
      await savePreset(editingName, editStyle);
    } else if (mode === 'create') {
      const trimmed = newName.trim();
      if (!trimmed) return; // name required
      await savePreset(trimmed, editStyle);
      onSelectPreset(trimmed);
    }
    setMode('list');
  };

  const presetNames = Object.keys(subtitlePresets);

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={toggle}
        className="w-full flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded px-2 py-1
                   text-xs text-zinc-100 hover:border-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
      >
        <span className="truncate">{currentPreset}</span>
        <IconChevron />
      </button>

      {/* Popover panel */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
        >
          {mode === 'list' && (
            <div>
              {/* Preset list */}
              <div className="max-h-[40vh] overflow-y-auto">
                {presetNames.map((name) => (
                  <div
                    key={name}
                    className={`group flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer transition-colors
                      ${name === currentPreset ? 'bg-blue-600/20 text-blue-300' : 'text-zinc-300 hover:bg-zinc-800'}`}
                  >
                    {/* Swatch preview */}
                    <span
                      className="flex-shrink-0 w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center border border-zinc-600"
                      style={{
                        color: subtitlePresets[name]?.color ?? DEFAULT_SUBTITLE_STYLE.color,
                        background: subtitlePresets[name]?.background ?? DEFAULT_SUBTITLE_STYLE.background,
                        fontSize: '9px',
                      }}
                    >
                      Aa
                    </span>

                    {/* Name (click = select) */}
                    <span
                      className="flex-1 text-xs truncate"
                      onClick={() => handleSelect(name)}
                    >
                      {name}
                    </span>

                    {/* Action icons (visible on hover) */}
                    <span className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditClick(name); }}
                        className="p-0.5 rounded text-zinc-400 hover:text-blue-400 hover:bg-zinc-700"
                        title="Edit preset"
                      >
                        <IconPencil />
                      </button>
                      {name !== 'default' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteClick(name); }}
                          className="p-0.5 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700"
                          title="Delete preset"
                        >
                          <IconTrash />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* New style button */}
              <div className="border-t border-zinc-700">
                <button
                  onClick={handleCreateStart}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <IconPlus />
                  New Style
                </button>
              </div>
            </div>
          )}

          {(mode === 'edit' || mode === 'create') && (
            <div className="p-2.5">
              {/* Header: back + name */}
              <div className="flex items-center gap-1.5 mb-2.5 pb-2 border-b border-zinc-700">
                <button
                  onClick={handleSaveAndBack}
                  className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
                  title="Save & back"
                >
                  <IconBack />
                </button>
                {mode === 'edit' ? (
                  <span className="text-xs text-zinc-200 font-medium truncate">{editingName}</span>
                ) : (
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Preset name..."
                    autoFocus
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100
                               focus:outline-none focus:border-blue-500"
                  />
                )}
              </div>

              {/* Style fields */}
              <StyleForm style={editStyle} onChange={handleStyleField} />

              {/* Footer hint */}
              <div className="mt-2 pt-2 border-t border-zinc-700 text-[10px] text-zinc-500">
                {mode === 'edit'
                  ? 'Changes apply to all clips using this preset.'
                  : 'New preset will be applied to the current clip.'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
