import { useState } from 'react';
import type { ToolCallProgress } from '../../stores/appStore';
import ToolCallCard from './ToolCallCard';

interface Props {
  toolCalls: ToolCallProgress[];
  reasonings: string[];
}

function ReasoningBlock({ content, index }: { content: string; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 text-amber-400/80">
        <span>{expanded ? '\u25be' : '\u25b8'}</span>
        <span className="font-medium">Thinking</span>
        <span className="text-amber-400/50 text-[10px]">#{index + 1}</span>
      </div>
      {expanded && (
        <div className="mt-2 text-zinc-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * Renders reasonings and tool calls interleaved by iteration.
 * reasonings[0] corresponds to iteration 1, reasonings[1] to iteration 2, etc.
 */
export default function InterleavedProgress({ toolCalls, reasonings }: Props) {
  if (toolCalls.length === 0 && reasonings.length === 0) return null;

  // Group tool calls by iteration
  const toolsByIteration = new Map<number, ToolCallProgress[]>();
  for (const tc of toolCalls) {
    const list = toolsByIteration.get(tc.iteration) || [];
    list.push(tc);
    toolsByIteration.set(tc.iteration, list);
  }

  const maxIteration = toolCalls.length > 0
    ? Math.max(...toolCalls.map((tc) => tc.iteration))
    : 0;
  const totalSteps = Math.max(maxIteration, reasonings.length);

  const elements: React.ReactNode[] = [];

  for (let i = 1; i <= totalSteps; i++) {
    // Reasoning for this iteration (reasonings[i-1])
    if (reasonings[i - 1]) {
      elements.push(
        <ReasoningBlock key={`r-${i}`} content={reasonings[i - 1]} index={i - 1} />
      );
    }
    // Tool calls for this iteration
    const iterTools = toolsByIteration.get(i);
    if (iterTools) {
      iterTools.forEach((tc, j) => {
        elements.push(
          <ToolCallCard key={`tc-${i}-${tc.toolName}-${j}`} toolCall={tc} />
        );
      });
    }
  }

  return <>{elements}</>;
}
