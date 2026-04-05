import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { sendChatMessage } from '../../lib/api';
import AgentProgressDisplay from '../chat/AgentProgressDisplay';
import MessageProgressDisplay from '../chat/MessageProgressDisplay';

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messages = useAppStore(s => s.messages);
  const addMessage = useAppStore(s => s.addMessage);
  const projectId = useAppStore(s => s.projectId);
  const archiveAgentProgress = useAppStore(s => s.archiveAgentProgress);
  const wsSend = useAppStore(s => s.wsSend);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  const handleAbort = useCallback(() => {
    if (!projectId || !wsSend) return;
    wsSend(JSON.stringify({ type: 'abort_agent', project_id: projectId }));
    abortControllerRef.current?.abort();
  }, [projectId, wsSend]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    addMessage({ role: 'user', content: text });
    setInput('');
    setSending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await sendChatMessage(text, projectId || 'default', controller.signal);
      if (res.message) {
        const { toolCalls, reasonings } = archiveAgentProgress();
        addMessage({ role: 'assistant', content: res.message, toolCalls, reasonings });
      }
    } catch (e: any) {
      const { toolCalls, reasonings } = archiveAgentProgress();
      if (e.name === 'AbortError') {
        addMessage({ role: 'assistant', content: 'Interrupted by user.', toolCalls, reasonings });
      } else {
        addMessage({ role: 'system', content: `Error: ${e.message}` });
      }
    } finally {
      abortControllerRef.current = null;
      setSending(false);
    }
  }, [input, sending, projectId, addMessage, archiveAgentProgress]);

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
          <div key={i}>
            {msg.role === 'assistant' && (msg.toolCalls || msg.reasonings) && (
              <MessageProgressDisplay toolCalls={msg.toolCalls} reasonings={msg.reasonings} />
            )}
            <div
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
          </div>
        ))}
        <AgentProgressDisplay />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-zinc-800">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your edit..."
            disabled={sending}
            rows={1}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 resize-none max-h-40 overflow-y-auto"
          />
          {sending ? (
            <button
              onClick={handleAbort}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
