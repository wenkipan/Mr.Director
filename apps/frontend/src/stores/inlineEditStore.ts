import { create } from 'zustand';
import { useAppStore } from './appStore';
import { updateClipInTimeline } from '../components/timeline/timelineUtils';

type EditingField = 'subtitle_text';

interface InlineEditStore {
  editingClipId: string | null;
  editingField: EditingField | null;
  draftText: string;
  originalText: string;

  startEditing: (clipId: string, field: EditingField, currentText: string) => void;
  updateDraft: (text: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
}

export const useInlineEditStore = create<InlineEditStore>((set, get) => ({
  editingClipId: null,
  editingField: null,
  draftText: '',
  originalText: '',

  startEditing: (clipId, field, currentText) => {
    set({
      editingClipId: clipId,
      editingField: field,
      draftText: currentText,
      originalText: currentText,
    });
    document.dispatchEvent(new CustomEvent('inlineEdit:start'));
  },

  updateDraft: (text) => set({ draftText: text }),

  commitEdit: () => {
    const { editingClipId, editingField, draftText, originalText } = get();
    if (!editingClipId || !editingField) return;

    if (draftText !== originalText) {
      const { timeline, updateTimeline } = useAppStore.getState();
      if (timeline) {
        const updates = { subtitle_text: draftText };
        const newTimeline = updateClipInTimeline(timeline, editingClipId, updates);
        updateTimeline(newTimeline);
      }
    }

    set({ editingClipId: null, editingField: null, draftText: '', originalText: '' });
    document.dispatchEvent(new CustomEvent('inlineEdit:end'));
  },

  cancelEdit: () => {
    set({ editingClipId: null, editingField: null, draftText: '', originalText: '' });
    document.dispatchEvent(new CustomEvent('inlineEdit:end'));
  },
}));
