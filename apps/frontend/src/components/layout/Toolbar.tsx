import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { listProjects, createProject, getProject, renameProject, startExport, getExportStatus, exportInterchange, exportAss, getGpuStatus, type GpuStatus } from '../../lib/api';
import ExportProgressModal from './ExportProgressModal';

type ExportStatus = 'idle' | 'queued' | 'rendering' | 'completed' | 'error';

interface ExportState {
  exportId: string | null;
  status: ExportStatus;
  progress: number;
  error: string | null;
}

export default function Toolbar() {
  const { timeline, projectId, setProjectId, setTimeline, clearMessages, loadSubtitlePresets } = useAppStore();
  const [exportState, setExportState] = useState<ExportState>({
    exportId: null,
    status: 'idle',
    progress: 0,
    error: null,
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [projectListOpen, setProjectListOpen] = useState(false);
  const [projectList, setProjectList] = useState<{ project_id: string; name: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Fetch GPU status on mount
  useEffect(() => {
    getGpuStatus()
      .then(setGpuStatus)
      .catch((err) => console.warn('GPU check failed:', err));
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!dropdownOpen && !projectListOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (projectListOpen && projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setProjectListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen, projectListOpen]);

  // Listen for WebSocket export progress events
  useEffect(() => {
    const handler = (e: Event) => {
      const { export_id, progress, status } = (e as CustomEvent).detail;
      setExportState((s) => {
        if (s.exportId !== export_id) return s;
        return { ...s, progress, status };
      });
    };
    document.addEventListener('export:progress', handler);
    return () => document.removeEventListener('export:progress', handler);
  }, []);

  // Polling fallback for progress
  useEffect(() => {
    if (!exportState.exportId || exportState.status === 'idle' || exportState.status === 'completed' || exportState.status === 'error') {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const data = await getExportStatus(exportState.exportId!);
        setExportState((s) => ({
          ...s,
          status: data.status,
          progress: data.progress,
          error: data.error,
        }));
      } catch {
        // WebSocket will handle updates
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [exportState.exportId, exportState.status]);

  const handleExportMp4 = useCallback(async (format: string = 'mp4') => {
    if (!projectId) return;
    setDropdownOpen(false);
    setExportState({ exportId: null, status: 'queued', progress: 0, error: null });
    try {
      const data = await startExport(projectId, format);
      setExportState({ exportId: data.export_id, status: 'rendering', progress: 0, error: null });
    } catch (e: any) {
      setExportState({ exportId: null, status: 'error', progress: 0, error: e.message || 'Failed to start export' });
    }
  }, [projectId]);

  const handleExportH264 = useCallback(async (subtitleBurnIn: 'ass' | 'srt' | 'none') => {
    if (!projectId) return;
    setDropdownOpen(false);
    setExportState({ exportId: null, status: 'queued', progress: 0, error: null });
    try {
      const data = await startExport(projectId, 'h264', subtitleBurnIn);
      setExportState({ exportId: data.export_id, status: 'rendering', progress: 0, error: null });
    } catch (e: any) {
      setExportState({ exportId: null, status: 'error', progress: 0, error: e.message || 'Failed to start export' });
    }
  }, [projectId]);

  const handleExportInterchange = useCallback(async (format: 'otio' | 'fcpxml') => {
    if (!projectId) return;
    setDropdownOpen(false);
    try {
      await exportInterchange(projectId, format);
    } catch (e: any) {
      setExportState({ exportId: null, status: 'error', progress: 0, error: e.message || `Failed to export ${format}` });
    }
  }, [projectId]);

  const handleExportAss = useCallback(async () => {
    if (!projectId) return;
    setDropdownOpen(false);
    try {
      await exportAss(projectId);
    } catch (e: any) {
      setExportState({ exportId: null, status: 'error', progress: 0, error: e.message || 'Failed to export ASS' });
    }
  }, [projectId]);

  const handleCloseModal = useCallback(() => {
    setExportState({ exportId: null, status: 'idle', progress: 0, error: null });
  }, []);

  const handleToggleProjectList = useCallback(async () => {
    if (projectListOpen) {
      setProjectListOpen(false);
      return;
    }
    try {
      const list = await listProjects();
      setProjectList(list);
      setProjectListOpen(true);
    } catch (e: any) {
      console.error('Failed to list projects:', e);
    }
  }, [projectListOpen]);

  const handleSwitchProject = useCallback(async (id: string) => {
    setProjectListOpen(false);
    if (id === projectId) return;
    try {
      const res = await getProject(id);
      setProjectId(id);
      setTimeline(res.timeline, res.version ?? 0);
      loadSubtitlePresets();
      clearMessages();
    } catch (e: any) {
      console.error('Failed to load project:', e);
    }
  }, [projectId, setProjectId, setTimeline, clearMessages, loadSubtitlePresets]);

  const handleNewProject = useCallback(async () => {
    try {
      const res = await createProject('Untitled');
      setProjectId(res.project_id);
      setTimeline(res.timeline, 0);
      loadSubtitlePresets();
      clearMessages();
    } catch (e: any) {
      console.error('Failed to create project:', e);
    }
  }, [setProjectId, setTimeline, clearMessages, loadSubtitlePresets]);

  const handleStartRename = useCallback((e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingName(name);
    setTimeout(() => editInputRef.current?.select(), 0);
  }, []);

  const handleCommitRename = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editingName.trim() || 'Untitled';
    try {
      await renameProject(editingId, trimmed);
      setProjectList((prev) => prev.map((p) => p.project_id === editingId ? { ...p, name: trimmed } : p));
      // Update current timeline name if renaming the active project
      if (editingId === projectId && timeline) {
        setTimeline({ ...timeline, project: { ...timeline.project, name: trimmed } });
      }
    } catch (e: any) {
      console.error('Failed to rename project:', e);
    }
    setEditingId(null);
  }, [editingId, editingName, projectId, timeline, setTimeline]);

  const hasContent = timeline && timeline.tracks.length > 0;
  const isExporting = exportState.status === 'queued' || exportState.status === 'rendering';

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
        {/* Left: project name (clickable to switch) */}
        <div className="relative" ref={projectDropdownRef}>
          <button
            onClick={handleToggleProjectList}
            className="text-sm font-medium text-zinc-400 truncate hover:text-zinc-200
                       flex items-center gap-1 transition-colors"
          >
            {timeline?.project.name ?? 'Untitled'}
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {projectListOpen && (
            <div className="absolute left-0 mt-1 w-56 max-h-64 overflow-y-auto rounded bg-zinc-800 border border-zinc-700 shadow-lg z-50 py-1">
              {projectList.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-zinc-500">No projects</div>
              ) : (
                projectList.map((p) => (
                  <div
                    key={p.project_id}
                    className={`flex items-center px-3 py-1.5 text-xs transition-colors ${
                      p.project_id === projectId
                        ? 'text-blue-400 bg-zinc-700/50'
                        : 'text-zinc-200 hover:bg-zinc-700'
                    }`}
                  >
                    {editingId === p.project_id ? (
                      <input
                        ref={editInputRef}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={handleCommitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCommitRename();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-1 py-0.5 text-xs text-zinc-100 outline-none focus:border-blue-500"
                        autoFocus
                      />
                    ) : (
                      <>
                        <button
                          onClick={() => handleSwitchProject(p.project_id)}
                          className="flex-1 text-left truncate"
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={(e) => handleStartRename(e, p.project_id, p.name)}
                          className="ml-1.5 p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-600 transition-colors shrink-0"
                          title="Rename"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right: New project + GPU warning + export dropdown */}
        <div className="flex items-center">
          <button
            onClick={handleNewProject}
            className="px-3 py-1 text-xs font-medium rounded bg-zinc-700 text-zinc-200
                       hover:bg-zinc-600 flex items-center gap-1.5 transition-colors mr-2"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
          {gpuStatus && !gpuStatus.gpu_available && (
            <div
              className="flex items-center gap-1 text-xs text-amber-400 mr-2 cursor-help"
              title={gpuStatus.reason}
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline truncate max-w-[120px]">CPU render</span>
            </div>
          )}
          <div className="relative" ref={dropdownRef}>
          <div className="flex items-center">
            {/* Main export button (MP4) */}
            <button
              onClick={() => handleExportMp4()}
              disabled={!hasContent || isExporting}
              className="px-3 py-1 text-xs font-medium rounded-l bg-blue-600 text-white
                         hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                         flex items-center gap-1.5 transition-colors"
            >
              {isExporting ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export
                </>
              )}
            </button>

            {/* Dropdown arrow */}
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              disabled={!hasContent || isExporting}
              className="px-1.5 py-1 text-xs font-medium rounded-r bg-blue-700 text-white
                         hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed
                         border-l border-blue-500 transition-colors"
            >
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-1 w-48 rounded bg-zinc-800 border border-zinc-700 shadow-lg z-50 py-1">
              <button
                onClick={() => handleExportMp4('mp4')}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Export MP4 (Remotion)
              </button>
              <div className="px-3 pt-1.5 pb-0.5 text-xs text-zinc-500 font-medium">MP4 (FFmpeg/h264)</div>
              <button
                onClick={() => handleExportH264('ass')}
                className="w-full text-left px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Burn-in ASS (styled)
              </button>
              <button
                onClick={() => handleExportH264('srt')}
                className="w-full text-left px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Burn-in SRT (plain)
              </button>
              <button
                onClick={() => handleExportH264('none')}
                className="w-full text-left px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                No subtitle burn-in
              </button>
              <div className="my-1 border-t border-zinc-700" />
              <button
                onClick={() => handleExportInterchange('otio')}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Export OTIO
              </button>
              <button
                onClick={() => handleExportInterchange('fcpxml')}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Export FCPXML
              </button>
              <button
                onClick={handleExportAss}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Export ASS subtitle
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Export progress toast */}
      {exportState.status !== 'idle' && (
        <ExportProgressModal
          exportId={exportState.exportId}
          progress={exportState.progress}
          status={exportState.status}
          error={exportState.error}
          warning={gpuStatus && !gpuStatus.gpu_available
            ? `Software rendering (slower): ${gpuStatus.reason}`
            : null}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}
