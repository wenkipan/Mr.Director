export type FontCategory = 'sans-serif' | 'serif' | 'monospace' | 'display' | 'cjk';
export type FontSource = 'generic' | 'system' | 'google';

export interface FontDefinition {
  id: string;
  displayName: string;
  category: FontCategory;
  source: FontSource;
  /** Name used by fontconfig / libass (ASS Fontname field). */
  fontconfigName: string;
  /** CSS font-family value including fallback stack. */
  cssFontFamily: string;
  /** Module name inside @remotion/google-fonts (only for source=google). */
  googleFontsModule?: string;
}

export const SUPPORTED_FONTS: FontDefinition[] = [
  // ── CSS Generic Families ─────────────────────────────────
  { id: 'sans-serif', displayName: 'Sans Serif', category: 'sans-serif', source: 'generic', fontconfigName: 'Arial', cssFontFamily: 'sans-serif' },
  { id: 'serif', displayName: 'Serif', category: 'serif', source: 'generic', fontconfigName: 'Times New Roman', cssFontFamily: 'serif' },
  { id: 'monospace', displayName: 'Monospace', category: 'monospace', source: 'generic', fontconfigName: 'Courier New', cssFontFamily: 'monospace' },

  // ── System Fonts (msttcorefonts) ─────────────────────────
  { id: 'arial', displayName: 'Arial', category: 'sans-serif', source: 'system', fontconfigName: 'Arial', cssFontFamily: "'Arial', sans-serif" },
  { id: 'times-new-roman', displayName: 'Times New Roman', category: 'serif', source: 'system', fontconfigName: 'Times New Roman', cssFontFamily: "'Times New Roman', serif" },
  { id: 'courier-new', displayName: 'Courier New', category: 'monospace', source: 'system', fontconfigName: 'Courier New', cssFontFamily: "'Courier New', monospace" },
  { id: 'georgia', displayName: 'Georgia', category: 'serif', source: 'system', fontconfigName: 'Georgia', cssFontFamily: "'Georgia', serif" },
  { id: 'impact', displayName: 'Impact', category: 'display', source: 'system', fontconfigName: 'Impact', cssFontFamily: "'Impact', sans-serif" },

  // ── System Fonts (Noto) ──────────────────────────────────
  { id: 'noto-sans', displayName: 'Noto Sans', category: 'sans-serif', source: 'system', fontconfigName: 'Noto Sans', cssFontFamily: "'Noto Sans', sans-serif" },
  { id: 'noto-serif', displayName: 'Noto Serif', category: 'serif', source: 'system', fontconfigName: 'Noto Serif', cssFontFamily: "'Noto Serif', serif" },

  // ── System Fonts (CJK) ──────────────────────────────────
  { id: 'noto-sans-sc', displayName: 'Noto Sans SC', category: 'cjk', source: 'system', fontconfigName: 'Noto Sans CJK SC', cssFontFamily: "'Noto Sans SC', 'Noto Sans CJK SC', sans-serif" },
  { id: 'noto-sans-tc', displayName: 'Noto Sans TC', category: 'cjk', source: 'system', fontconfigName: 'Noto Sans CJK TC', cssFontFamily: "'Noto Sans TC', 'Noto Sans CJK TC', sans-serif" },
  { id: 'noto-sans-jp', displayName: 'Noto Sans JP', category: 'cjk', source: 'system', fontconfigName: 'Noto Sans CJK JP', cssFontFamily: "'Noto Sans JP', 'Noto Sans CJK JP', sans-serif" },

  // ── Google Fonts ─────────────────────────────────────────
  { id: 'roboto', displayName: 'Roboto', category: 'sans-serif', source: 'google', fontconfigName: 'Roboto', cssFontFamily: "'Roboto', sans-serif", googleFontsModule: 'Roboto' },
  { id: 'inter', displayName: 'Inter', category: 'sans-serif', source: 'google', fontconfigName: 'Inter', cssFontFamily: "'Inter', sans-serif", googleFontsModule: 'Inter' },
  { id: 'open-sans', displayName: 'Open Sans', category: 'sans-serif', source: 'google', fontconfigName: 'Open Sans', cssFontFamily: "'Open Sans', sans-serif", googleFontsModule: 'OpenSans' },
  { id: 'montserrat', displayName: 'Montserrat', category: 'sans-serif', source: 'google', fontconfigName: 'Montserrat', cssFontFamily: "'Montserrat', sans-serif", googleFontsModule: 'Montserrat' },
  { id: 'poppins', displayName: 'Poppins', category: 'sans-serif', source: 'google', fontconfigName: 'Poppins', cssFontFamily: "'Poppins', sans-serif", googleFontsModule: 'Poppins' },
  { id: 'lato', displayName: 'Lato', category: 'sans-serif', source: 'google', fontconfigName: 'Lato', cssFontFamily: "'Lato', sans-serif", googleFontsModule: 'Lato' },
  { id: 'merriweather', displayName: 'Merriweather', category: 'serif', source: 'google', fontconfigName: 'Merriweather', cssFontFamily: "'Merriweather', serif", googleFontsModule: 'Merriweather' },
  { id: 'playfair-display', displayName: 'Playfair Display', category: 'serif', source: 'google', fontconfigName: 'Playfair Display', cssFontFamily: "'Playfair Display', serif", googleFontsModule: 'PlayfairDisplay' },
  { id: 'oswald', displayName: 'Oswald', category: 'display', source: 'google', fontconfigName: 'Oswald', cssFontFamily: "'Oswald', sans-serif", googleFontsModule: 'Oswald' },
  { id: 'bebas-neue', displayName: 'Bebas Neue', category: 'display', source: 'google', fontconfigName: 'Bebas Neue', cssFontFamily: "'Bebas Neue', sans-serif", googleFontsModule: 'BebasNeue' },
];

export const FONT_BY_ID: Record<string, FontDefinition> = Object.fromEntries(
  SUPPORTED_FONTS.map((f) => [f.id, f]),
);

/**
 * Resolve a font_family value (font ID, CSS generic, or raw name) to a CSS
 * font-family string suitable for browser rendering.
 */
export function resolveCssFontFamily(fontFamily: string): string {
  const font = FONT_BY_ID[fontFamily];
  if (font) return font.cssFontFamily;
  // Pass through raw CSS values (e.g. "'Arial', sans-serif" or "sans-serif")
  return fontFamily;
}
