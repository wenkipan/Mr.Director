import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import ToolCallCard from './ToolCallCard';

export default function AgentProgressDisplay() {
  const { agentProgress } = useAppStore();
  const [showReasoning, setShowReasoning] = useState(false);

  if (!agentProgress.isActive && agentProgress.toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 my-2">
      {agentProgress.reasoning && (
        <div
          className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs cursor-pointer"
          onClick={() => setShowReasoning(!showReasoning)}
        >
          <div className="flex items-center gap-2 text-amber-400/80">
            <span>{showReasoning ? '\u25be' : '\u25b8'}</span>
            <span className="font-medium">Thinking</span>
          </div>
          {showReasoning && (
            <div className="mt-2 text-zinc-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {agentProgress.reasoning}
            </div>
          )}
        </div>
      )}
      {agentProgress.toolCalls.map((tc, i) => (
        <ToolCallCard key={`${tc.iteration}-${tc.toolName}-${i}`} toolCall={tc} />
      ))}
      {agentProgress.isActive && agentProgress.toolCalls.every((tc) => tc.status !== 'running') && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Thinking...</span>
        </div>
      )}
    </div>
  );
}
