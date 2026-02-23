import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

export function useWebSocket(projectId: string | null) {
  const { setTimeline, addMessage, setWsConnected } = useAppStore();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const ws = new WebSocket(`ws://${window.location.host}/ws/timeline?project_id=${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'timeline_update':
            setTimeline(msg.data);
            break;
          case 'agent_message':
            addMessage({ role: 'assistant', content: msg.data.text });
            break;
          case 'agent_thinking':
            // Could show a thinking indicator
            break;
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
      wsRef.current = null;
    };
  }, [projectId, setTimeline, addMessage, setWsConnected]);

  return wsRef;
}
