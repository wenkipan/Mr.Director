/**
 * Centralized theme constants for MrDV2.
 *
 * Tailwind classes handle most styling, but Canvas 2D, inline styles, and
 * non-Tailwind contexts (scrollbar CSS) need raw color values.  Keeping them
 * here avoids a "shadow theme" scattered across components.
 *
 * Color names mirror Tailwind's zinc / blue / red / amber / green / yellow
 * palette so the mapping stays obvious.
 */

// ── Zinc neutrals (dark theme) ──────────────────────────────────────────────
export const zinc950 = '#18181b';
export const zinc900 = '#27272a';
export const zinc800 = '#3f3f46';
export const zinc600 = '#52525b';
export const zinc400 = '#a1a1aa';

// ── Accent / semantic colors ────────────────────────────────────────────────
export const blue500 = '#3b82f6';
export const red500  = '#ef4444';
export const amber400 = '#facc15';
export const green500 = '#22c55e';
export const yellow500 = '#eab308';
export const gray500  = '#6b7280';

// ── Timeline-specific ───────────────────────────────────────────────────────

/** Alternating track lane backgrounds (slightly offset from zinc-950) */
export const trackLaneEven = '#1c1c20';
export const trackLaneOdd  = '#202024';

/** Track type accent colors — used for clip backgrounds, track indicators, etc. */
export const TRACK_COLORS: Record<string, string> = {
  video: blue500,
  audio: green500,
  subtitle: yellow500,
};

// ── Fade overlay ────────────────────────────────────────────────────────────
export const fadeOverlayStart = 'rgba(0,0,0,0.6)';
