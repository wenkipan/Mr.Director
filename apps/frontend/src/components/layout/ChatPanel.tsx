import { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { sendChatMessage } from '../../lib/api';
import AgentProgressDisplay from '../chat/AgentProgressDisplay';

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const { messages, addMessage, projectId, onAgentDone } = useAppStore();

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    addMessage({ role: 'user', content: text });
    setInput('');
    setSending(true);

    try {
      const res = await sendChatMessage(text, projectId || 'default');
      if (res.message) {
        addMessage({ role: 'assistant', content: res.message });
      }
    } catch (e: any) {
      addMessage({ role: 'system', content: `Error: ${e.message}` });
    } finally {
      setSending(false);
      onAgentDone(); // Safety reset in case WS disconnected
    }
  }, [input, sending, projectId, addMessage, onAgentDone]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900 border-l border-zinc-800">
      <div className="px-3 py-2 border-b border-zinc-800 text-sm font-medium text-zinc-400">
        Chat
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-zinc-500 text-sm">
            Tell Mr.Director how you'd like to edit your video.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-blue-900/40 text-blue-100 ml-4'
                : msg.role === 'system'
                  ? 'bg-red-900/30 text-red-300 text-xs'
                  : 'bg-zinc-800 text-zinc-200 mr-4'
            }`}
          >
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}
        <AgentProgressDisplay />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your edit..."
            disabled={sending}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
