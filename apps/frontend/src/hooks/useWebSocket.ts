import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

export function useWebSocket(projectId: string | null) {
  const { setTimelineFromServer, addMessage, setWsConnected, setWsSend, onToolStart, onToolEnd, onAgentReasoning, onAgentDone, onAgentAborted } = useAppStore();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const ws = new WebSocket(`ws://${window.location.host}/ws/timeline?project_id=${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setWsSend((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
    };
    ws.onclose = () => {
      setWsConnected(false);
      setWsSend(null);
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'timeline_update':
            setTimelineFromServer(msg.data, msg.version ?? 0);
            break;
          case 'agent_message':
            // Legacy — no longer used (REST response is canonical)
            break;
          case 'agent_thinking':
            // Legacy — superseded by agent_progress
            break;
          case 'export_progress': {
            const { export_id, progress, status } = msg.data;
            document.dispatchEvent(
              new CustomEvent('export:progress', { detail: { export_id, progress, status } })
            );
            break;
          }
          case 'agent_reasoning': {
            const { reasoning } = msg.data;
            onAgentReasoning(reasoning);
            break;
          }
          case 'agent_progress': {
            const { event: evt, tool_name, tool_args, result_summary, is_error, iteration } = msg.data;
            switch (evt) {
              case 'tool_start':
                onToolStart(tool_name, tool_args || {}, iteration);
                break;
              case 'tool_end':
                onToolEnd(tool_name, result_summary || '', is_error);
                break;
              case 'agent_done':
                onAgentDone();
                break;
              case 'agent_aborted':
                onAgentAborted();
                break;
            }
            break;
          }
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    ws.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    return () => {
      ws.close();
      setWsSend(null);
      wsRef.current = null;
    };
  }, [projectId, setTimelineFromServer, addMessage, setWsConnected, setWsSend, onToolStart, onToolEnd, onAgentReasoning, onAgentDone, onAgentAborted]);

  return wsRef;
}
