import { useState, useCallback } from 'react';
import { useAppStore, getMediaUrl, type MediaFileInfo } from '../../stores/appStore';
import { fetchMediaList } from '../../lib/api';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const TYPE_ICONS: Record<string, string> = {
  video: '🎬',
  audio: '🎵',
  image: '🖼',
  directory: '📁',
};

export default function MediaPanel() {
  const { mediaDir, setMediaDir, mediaFiles, setMediaFiles, selectedMedia, setSelectedMedia } = useAppStore();
  const [dirInput, setDirInput] = useState(mediaDir);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  const loadDir = useCallback(async (dir: string) => {
    if (!dir.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchMediaList(dir.trim());
      setMediaDir(data.dir);
      setDirInput(data.dir);
      setMediaFiles(data.files);
    } catch (e: any) {
      setError(e.message || 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, [setMediaDir, setMediaFiles]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mediaDir) setHistory((h) => [mediaDir, ...h.filter((d) => d !== mediaDir)].slice(0, 10));
    loadDir(dirInput);
  };

  const handleFileClick = (file: MediaFileInfo) => {
    if (file.type === 'directory') {
      setHistory((h) => [mediaDir, ...h.filter((d) => d !== mediaDir)].slice(0, 10));
      loadDir(file.path);
    } else {
      setSelectedMedia(file.path);
    }
  };

  const goUp = () => {
    const parent = mediaDir.replace(/\/[^/]+\/?$/, '') || '/';
    setHistory((h) => [mediaDir, ...h.filter((d) => d !== mediaDir)].slice(0, 10));
    loadDir(parent);
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900 border-r border-zinc-800">
      <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
        Media
      </div>

      {/* Directory input */}
      <form onSubmit={handleSubmit} className="p-2 border-b border-zinc-800">
        <div className="flex gap-1">
          <input
            type="text"
            value={dirInput}
            onChange={(e) => setDirInput(e.target.value)}
            placeholder="/path/to/media"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 min-w-0"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors disabled:opacity-50"
          >
            {loading ? '...' : 'Go'}
          </button>
        </div>
      </form>

      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-950/30 border-b border-zinc-800">
          {error}
        </div>
      )}

      {/* Navigation bar */}
      {mediaDir && (
        <div className="px-2 py-1 border-b border-zinc-800 flex items-center gap-1">
          <button onClick={goUp} className="text-xs text-zinc-400 hover:text-zinc-200 px-1">
            ↑ Up
          </button>
          <span className="text-xs text-zinc-600 truncate flex-1" title={mediaDir}>
            {mediaDir}
          </span>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {mediaFiles.length === 0 && mediaDir && !loading && (
          <div className="p-3 text-xs text-zinc-600 text-center">No media files found</div>
        )}
        {!mediaDir && !loading && (
          <div className="p-3 text-xs text-zinc-600 text-center">
            Enter a directory path above to browse media files
          </div>
        )}
        {mediaFiles.map((file) => (
          <button
            key={file.path}
            onClick={() => handleFileClick(file)}
            draggable={file.type !== 'directory'}
            onDragStart={(e) => {
              if (file.type === 'directory') {
                e.preventDefault();
                return;
              }
              e.dataTransfer.setData(
                'application/x-mrdv2-media',
                JSON.stringify({ name: file.name, path: file.path, type: file.type, duration: file.duration, width: file.width, height: file.height }),
              );
              e.dataTransfer.effectAllowed = 'copy';
              (e.currentTarget as HTMLElement).style.opacity = '0.4';
            }}
            onDragEnd={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = '';
            }}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 ${
              selectedMedia === file.path ? 'bg-blue-950/40 border-l-2 border-l-blue-500' : ''
            }`}
          >
            <span className="text-sm flex-shrink-0">{TYPE_ICONS[file.type] || '📄'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-200 truncate">{file.name}</div>
              {file.size != null && (
                <div className="text-xs text-zinc-500">{formatSize(file.size)}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
