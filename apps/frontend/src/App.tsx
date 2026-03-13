import { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import MediaPanel from './components/layout/MediaPanel';
import CenterPanel from './components/layout/CenterPanel';
import ChatPanel from './components/layout/ChatPanel';
import ClipPropertiesEditor from './components/layout/ClipPropertiesEditor';
import { useWebSocket } from './hooks/useWebSocket';
import { useAppStore } from './stores/appStore';
import { createProject, getProject } from './lib/api';

export default function App() {
  const { projectId, setProjectId, setTimeline, loadSubtitlePresets } = useAppStore();

  // Initialize project on first load, or reload existing project
  useEffect(() => {
    if (!projectId) {
      // No saved project — create a new one
      createProject('Untitled')
        .then((res) => {
          setProjectId(res.project_id);
          setTimeline(res.timeline, 0);
          loadSubtitlePresets();
        })
        .catch((e) => console.error('Failed to create project:', e));
      return;
    }

    // Saved project exists — try to load it
    getProject(projectId)
      .then((res) => {
        setTimeline(res.timeline, res.version ?? 0);
        loadSubtitlePresets();
      })
      .catch(() => {
        // Project no longer exists on backend — create a new one
        setProjectId(null);
      });
  }, [projectId, setProjectId, setTimeline]);

  // Connect WebSocket for real-time updates
  useWebSocket(projectId);

  return (
    <div className="h-full bg-zinc-950 text-zinc-100">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Left: Media Browser + Clip Properties */}
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={50} minSize={20}>
              <MediaPanel />
            </Panel>
            <PanelResizeHandle className="h-1 bg-zinc-950 hover:bg-zinc-700 transition-colors" />
            <Panel defaultSize={50} minSize={20}>
              <ClipPropertiesEditor />
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="w-1 bg-zinc-950 hover:bg-zinc-700 transition-colors" />

        {/* Center: Preview + Timeline */}
        <Panel defaultSize={55} minSize={40}>
          <CenterPanel />
        </Panel>

        <PanelResizeHandle className="w-1 bg-zinc-950 hover:bg-zinc-700 transition-colors" />

        {/* Right: Chat */}
        <Panel defaultSize={25} minSize={15} maxSize={35}>
          <ChatPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}
