import { create } from 'zustand';

interface SelectionStore {
  selectedClipIds: Set<string>;
  selectClip: (clipId: string, multi: boolean) => void;
  setSelection: (clipIds: Set<string>) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedClipIds: new Set(),

  selectClip: (clipId, multi) =>
    set((state) => {
      if (multi) {
        const next = new Set(state.selectedClipIds);
        if (next.has(clipId)) {
          next.delete(clipId);
        } else {
          next.add(clipId);
        }
        return { selectedClipIds: next };
      }
      // Single select — if already the only selection, keep it
      if (state.selectedClipIds.size === 1 && state.selectedClipIds.has(clipId)) {
        return state;
      }
      return { selectedClipIds: new Set([clipId]) };
    }),

  setSelection: (clipIds) =>
    set((state) => {
      if (
        clipIds.size === state.selectedClipIds.size &&
        [...clipIds].every((id) => state.selectedClipIds.has(id))
      ) {
        return state;
      }
      return { selectedClipIds: new Set(clipIds) };
    }),

  clearSelection: () =>
    set((state) =>
      state.selectedClipIds.size === 0 ? state : { selectedClipIds: new Set() },
    ),
}));
