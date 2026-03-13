import { create } from 'zustand';
import type { Clip } from '@mrdv2/shared';

export interface CopiedClipInfo {
  clip: Clip;
  originalTrackId: string;
}

interface ClipboardStore {
  copiedClips: CopiedClipInfo[];
  copyClips: (clips: CopiedClipInfo[]) => void;
  clearClipboard: () => void;
}

export const useClipboardStore = create<ClipboardStore>((set) => ({
  copiedClips: [],
  copyClips: (clips) => set({ copiedClips: clips }),
  clearClipboard: () => set({ copiedClips: [] }),
}));
