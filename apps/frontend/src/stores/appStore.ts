import { create } from 'zustand';
import type { TimelineProject, MediaAsset } from '@mrdv2/shared';

export interface MediaFileInfo {
  name: string;
  path: string;
  size?: number;
  mime_type?: string;
  type: 'video' | 'audio' | 'image' | 'directory';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface AppStore {
  // Timeline state
  timeline: TimelineProject | null;
  setTimeline: (t: TimelineProject | null) => void;

  // Playback state
  currentFrame: number;
  isPlaying: boolean;
  setCurrentFrame: (f: number) => void;
  setPlaying: (p: boolean) => void;

  // Chat state
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;

  // Media browser state
  mediaDir: string;
  mediaFiles: MediaFileInfo[];
  setMediaDir: (dir: string) => void;
  setMediaFiles: (files: MediaFileInfo[]) => void;
  selectedMedia: string | null;
  setSelectedMedia: (path: string | null) => void;

  // WebSocket connection
  wsConnected: boolean;
  setWsConnected: (c: boolean) => void;

  // Project
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

const API_BASE = '/api';

export const useAppStore = create<AppStore>((set) => ({
  // Timeline
  timeline: null,
  setTimeline: (t) => set({ timeline: t }),

  // Playback
  currentFrame: 0,
  isPlaying: false,
  setCurrentFrame: (f) => set({ currentFrame: f }),
  setPlaying: (p) => set({ isPlaying: p }),

  // Chat
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  clearMessages: () => set({ messages: [] }),

  // Media
  mediaDir: '',
  mediaFiles: [],
  setMediaDir: (dir) => set({ mediaDir: dir }),
  setMediaFiles: (files) => set({ mediaFiles: files }),
  selectedMedia: null,
  setSelectedMedia: (path) => set({ selectedMedia: path }),

  // WebSocket
  wsConnected: false,
  setWsConnected: (c) => set({ wsConnected: c }),

  // Project
  projectId: localStorage.getItem('mrdv2_projectId'),
  setProjectId: (id) => {
    if (id) {
      localStorage.setItem('mrdv2_projectId', id);
    } else {
      localStorage.removeItem('mrdv2_projectId');
    }
    set({ projectId: id });
  },
}));

export function getMediaUrl(filePath: string): string {
  return `${API_BASE}/media/file?path=${encodeURIComponent(filePath)}`;
}
