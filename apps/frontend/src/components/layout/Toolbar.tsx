import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { startExport, getExportStatus } from '../../lib/api';
import ExportProgressModal from './ExportProgressModal';

type ExportStatus = 'idle' | 'queued' | 'rendering' | 'completed' | 'error';

interface ExportState {
  exportId: string | null;
  status: ExportStatus;
  progress: number;
  error: string | null;
}

export default function Toolbar() {
  const { timeline, projectId } = useAppStore();
  const [exportState, setExportState] = useState<ExportState>({
    exportId: null,
    status: 'idle',
    progress: 0,
    error: null,
  });

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
    }, 2000);
    return () => clearInterval(interval);
  }, [exportState.exportId, exportState.status]);

  const handleExport = useCallback(async () => {
    if (!projectId) return;
    setExportState({ exportId: null, status: 'queued', progress: 0, error: null });
    try {
      const data = await startExport(projectId);
      setExportState({ exportId: data.export_id, status: 'rendering', progress: 0, error: null });
    } catch (e: any) {
      setExportState({ exportId: null, status: 'error', progress: 0, error: e.message || 'Failed to start export' });
    }
  }, [projectId]);

  const handleCloseModal = useCallback(() => {
    setExportState({ exportId: null, status: 'idle', progress: 0, error: null });
  }, []);

  const hasContent = timeline && timeline.tracks.length > 0;
  const isExporting = exportState.status === 'queued' || exportState.status === 'rendering';

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
        {/* Left: project name */}
        <span className="text-sm font-medium text-zinc-400 truncate">
          {timeline?.project.name ?? 'Untitled'}
        </span>

        {/* Right: export button */}
        <button
          onClick={handleExport}
          disabled={!hasContent || isExporting}
          className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white
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
      </div>

      {/* Export progress toast */}
      {exportState.status !== 'idle' && (
        <ExportProgressModal
          exportId={exportState.exportId}
          progress={exportState.progress}
          status={exportState.status}
          error={exportState.error}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}
