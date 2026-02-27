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

export interface ToolCallProgress {
  toolName: string;
  toolArgs?: Record<string, string>;
  status: 'running' | 'completed' | 'error';
  resultSummary?: string;
  iteration: number;
}

export interface AgentProgress {
  isActive: boolean;
  toolCalls: ToolCallProgress[];
}

const MAX_UNDO = 50;

interface AppStore {
  // Timeline state
  timeline: TimelineProject | null;
  setTimeline: (t: TimelineProject | null) => void;

  // Timeline editing (with undo support)
  setTimelineSilent: (t: TimelineProject) => void;
  updateTimeline: (newTimeline: TimelineProject) => void;
  undoStack: TimelineProject[];
  redoStack: TimelineProject[];
  undo: () => void;
  redo: () => void;
  timelineDirty: boolean;
  setTimelineDirty: (d: boolean) => void;

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

  // Agent progress
  agentProgress: AgentProgress;
  onToolStart: (toolName: string, toolArgs: Record<string, string>, iteration: number) => void;
  onToolEnd: (toolName: string, resultSummary: string, isError: boolean) => void;
  onAgentDone: () => void;

  // Project
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

const API_BASE = '/api';

export const useAppStore = create<AppStore>((set, get) => ({
  // Timeline
  timeline: null,
  setTimeline: (t) => set({ timeline: t, undoStack: [], redoStack: [] }),

  // Timeline editing with undo
  undoStack: [],
  redoStack: [],
  timelineDirty: false,
  setTimelineDirty: (d) => set({ timelineDirty: d }),

  setTimelineSilent: (t) => set({ timeline: t, timelineDirty: true }),

  updateTimeline: (newTimeline) => {
    const { timeline, undoStack } = get();
    if (!timeline) {
      set({ timeline: newTimeline, timelineDirty: true });
      return;
    }
    const newUndo = [...undoStack, timeline].slice(-MAX_UNDO);
    set({
      timeline: newTimeline,
      undoStack: newUndo,
      redoStack: [],
      timelineDirty: true,
    });
  },

  undo: () => {
    const { timeline, undoStack, redoStack } = get();
    if (undoStack.length === 0 || !timeline) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      timeline: prev,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, timeline],
      timelineDirty: true,
    });
  },

  redo: () => {
    const { timeline, undoStack, redoStack } = get();
    if (redoStack.length === 0 || !timeline) return;
    const next = redoStack[redoStack.length - 1];
    set({
      timeline: next,
      undoStack: [...undoStack, timeline!],
      redoStack: redoStack.slice(0, -1),
      timelineDirty: true,
    });
  },

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

  // Agent progress
  agentProgress: { isActive: false, toolCalls: [] },

  onToolStart: (toolName, toolArgs, iteration) =>
    set((s) => ({
      agentProgress: {
        isActive: true,
        toolCalls: [
          ...s.agentProgress.toolCalls,
          { toolName, toolArgs, status: 'running', iteration },
        ],
      },
    })),

  onToolEnd: (toolName, resultSummary, isError) =>
    set((s) => ({
      agentProgress: {
        ...s.agentProgress,
        toolCalls: s.agentProgress.toolCalls.map((tc) =>
          tc.toolName === toolName && tc.status === 'running'
            ? { ...tc, status: isError ? 'error' : 'completed', resultSummary }
            : tc
        ),
      },
    })),

  onAgentDone: () =>
    set({ agentProgress: { isActive: false, toolCalls: [] } }),

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
