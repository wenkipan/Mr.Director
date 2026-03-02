interface ExportProgressModalProps {
  exportId: string | null;
  progress: number;
  status: string;
  error: string | null;
  warning?: string | null;
  onClose: () => void;
}

export default function ExportProgressModal({
  exportId,
  progress,
  status,
  error,
  warning,
  onClose,
}: ExportProgressModalProps) {
  const pct = Math.round(progress * 100);

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl p-4 z-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-200">
          {status === 'completed'
            ? 'Export Complete'
            : status === 'error'
              ? 'Export Failed'
              : 'Exporting Video...'}
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-lg leading-none transition-colors"
        >
          &times;
        </button>
      </div>

      {/* Progress bar */}
      {status !== 'error' && (
        <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* GPU warning */}
      {warning && status !== 'error' && status !== 'completed' && (
        <p className="text-xs text-amber-400 mt-1.5 line-clamp-2" title={warning}>
          {warning}
        </p>
      )}

      <div className="mt-2 flex justify-between items-center">
        {status === 'error' ? (
          <span className="text-xs text-red-400 truncate" title={error ?? ''}>
            {error || 'Unknown error'}
          </span>
        ) : (
          <span className="text-xs text-zinc-400">{pct}%</span>
        )}

        {status === 'completed' && exportId && (
          <a
            href={`/api/export/${exportId}/download`}
            className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
            download
          >
            Download
          </a>
        )}
      </div>
    </div>
  );
}
