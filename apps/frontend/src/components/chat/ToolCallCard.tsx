import { useState } from 'react';
import type { ToolCallProgress } from '../../stores/appStore';

const SpinnerIcon = () => (
  <svg className="animate-spin w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ErrorIcon = () => (
  <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function ToolCallCard({ toolCall }: { toolCall: ToolCallProgress }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    running: <SpinnerIcon />,
    completed: <CheckIcon />,
    error: <ErrorIcon />,
  }[toolCall.status];

  const hasDetails =
    (toolCall.toolArgs && Object.keys(toolCall.toolArgs).length > 0) ||
    toolCall.resultSummary;

  return (
    <div
      className={`bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs ${hasDetails ? 'cursor-pointer' : ''}`}
      onClick={() => hasDetails && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="font-mono font-medium text-zinc-300">{toolCall.toolName}</span>
        {hasDetails && (
          <span className="text-zinc-600 ml-1">{expanded ? '▾' : '▸'}</span>
        )}
        <span className="ml-auto text-zinc-500">
          {toolCall.status === 'running' ? 'running...' : toolCall.status}
        </span>
      </div>

      {expanded && toolCall.toolArgs && Object.keys(toolCall.toolArgs).length > 0 && (
        <div className="mt-2 pl-6 text-zinc-400 font-mono whitespace-pre-wrap break-all">
          {Object.entries(toolCall.toolArgs).map(([k, v]) => (
            <div key={k}>
              <span className="text-zinc-500">{k}: </span>{v}
            </div>
          ))}
        </div>
      )}

      {expanded && toolCall.resultSummary && (
        <div className="mt-1 pl-6 text-zinc-500 font-mono whitespace-pre-wrap break-all">
          → {toolCall.resultSummary}
        </div>
      )}
    </div>
  );
}
