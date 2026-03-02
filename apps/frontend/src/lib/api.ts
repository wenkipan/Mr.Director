const API_BASE = '/api';

export async function fetchMediaList(dir: string) {
  const res = await fetch(`${API_BASE}/media/list?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error(`Failed to list media: ${res.statusText}`);
  return res.json();
}

export async function createProject(name: string = 'Untitled') {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.statusText}`);
  return res.json();
}

export async function getProject(projectId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to get project: ${res.statusText}`);
  return res.json();
}

export async function updateTimeline(
  projectId: string,
  timeline: any,
): Promise<{ project_id: string; version: number }> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/timeline`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(timeline),
  });
  if (!res.ok) {
    const err = new Error(`Failed to save timeline: ${res.status} ${res.statusText}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

export async function startExport(projectId: string, format: string = 'mp4') {
  const res = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, format }),
  });
  if (!res.ok) throw new Error(`Failed to start export: ${res.statusText}`);
  return res.json();
}

function _triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportInterchange(
  projectId: string,
  format: 'otio' | 'fcpxml',
  includeSrt: boolean = true,
): Promise<void> {
  const res = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, format, include_srt: includeSrt }),
  });
  if (!res.ok) throw new Error(`Failed to export ${format}: ${res.statusText}`);

  const blob = await res.blob();
  const ext = format === 'otio' ? '.otio' : '.fcpxml';
  _triggerDownload(blob, `${projectId}_export${ext}`);

  // Download companion SRT if available
  const exportId = res.headers.get('X-Export-Id');
  const srtAvailable = res.headers.get('X-SRT-Available');
  if (srtAvailable === 'true' && exportId) {
    const srtRes = await fetch(`${API_BASE}/export/${exportId}/srt`);
    if (srtRes.ok) {
      const srtBlob = await srtRes.blob();
      _triggerDownload(srtBlob, `${projectId}_subtitles.srt`);
    }
  }
}

export interface GpuStatus {
  gpu_available: boolean;
  gl_flag: string;
  reason: string;
}

export async function getGpuStatus(): Promise<GpuStatus> {
  const res = await fetch(`${API_BASE}/export/gpu-status`);
  if (!res.ok) throw new Error(`GPU status check failed: ${res.statusText}`);
  return res.json();
}

export async function getExportStatus(exportId: string) {
  const res = await fetch(`${API_BASE}/export/${exportId}/status`);
  if (!res.ok) throw new Error(`Failed to get export status: ${res.statusText}`);
  return res.json();
}

export async function sendChatMessage(message: string, projectId: string) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, project_id: projectId }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.statusText}`);
  return res.json();
}
