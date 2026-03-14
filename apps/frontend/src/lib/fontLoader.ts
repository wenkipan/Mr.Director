import { SUPPORTED_FONTS, FONT_BY_ID } from '@mrdv2/shared';

const loadedFonts = new Set<string>();

type FontModule = { loadFont: () => { fontFamily: string } };

const GOOGLE_FONT_LOADERS: Record<string, () => Promise<FontModule>> = {
  Roboto: () => import('@remotion/google-fonts/Roboto') as Promise<FontModule>,
  Inter: () => import('@remotion/google-fonts/Inter') as Promise<FontModule>,
  OpenSans: () => import('@remotion/google-fonts/OpenSans') as Promise<FontModule>,
  Montserrat: () => import('@remotion/google-fonts/Montserrat') as Promise<FontModule>,
  Poppins: () => import('@remotion/google-fonts/Poppins') as Promise<FontModule>,
  Lato: () => import('@remotion/google-fonts/Lato') as Promise<FontModule>,
  Merriweather: () => import('@remotion/google-fonts/Merriweather') as Promise<FontModule>,
  PlayfairDisplay: () => import('@remotion/google-fonts/PlayfairDisplay') as Promise<FontModule>,
  Oswald: () => import('@remotion/google-fonts/Oswald') as Promise<FontModule>,
  BebasNeue: () => import('@remotion/google-fonts/BebasNeue') as Promise<FontModule>,
};

export async function ensureFontLoaded(fontId: string): Promise<void> {
  if (loadedFonts.has(fontId)) return;
  const font = FONT_BY_ID[fontId];
  if (!font || font.source !== 'google' || !font.googleFontsModule) return;
  const loader = GOOGLE_FONT_LOADERS[font.googleFontsModule];
  if (!loader) return;
  const mod = await loader();
  mod.loadFont();
  loadedFonts.add(fontId);
}

export async function ensureAllGoogleFontsLoaded(): Promise<void> {
  const promises = SUPPORTED_FONTS
    .filter((f) => f.source === 'google' && f.googleFontsModule)
    .map((f) => ensureFontLoaded(f.id));
  await Promise.allSettled(promises);
}
