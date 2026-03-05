import type { ToolCallProgress } from '../../stores/appStore';
import InterleavedProgress from './InterleavedProgress';

interface Props {
  toolCalls?: ToolCallProgress[];
  reasonings?: string[];
}

/** Renders archived agent progress (tool calls + reasonings) for a chat message. */
export default function MessageProgressDisplay({ toolCalls, reasonings }: Props) {
  if (!toolCalls?.length && !reasonings?.length) return null;

  return (
    <div className="space-y-2 mb-2">
      <InterleavedProgress
        toolCalls={toolCalls || []}
        reasonings={reasonings || []}
      />
    </div>
  );
}
