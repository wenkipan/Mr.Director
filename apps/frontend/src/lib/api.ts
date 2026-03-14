const API_BASE = '/api';

export async function fetchMediaList(dir: string) {
  const res = await fetch(`${API_BASE}/media/list?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error(`Failed to list media: ${res.statusText}`);
  return res.json();
}

export async function listProjects(): Promise<{ project_id: string; name: string }[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error(`Failed to list projects: ${res.statusText}`);
  return res.json();
}

export async function createProject(
  name: string = 'Untitled',
  width?: number,
  height?: number,
  fps?: number,
) {
  const params = new URLSearchParams({ name });
  if (width != null) params.set('width', String(width));
  if (height != null) params.set('height', String(height));
  if (fps != null) params.set('fps', String(fps));
  const res = await fetch(`${API_BASE}/projects?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.statusText}`);
  return res.json();
}

export async function renameProject(projectId: string, name: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}/name?name=${encodeURIComponent(name)}`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error(`Failed to rename project: ${res.statusText}`);
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

export async function startExport(
  projectId: string,
  format: string = 'mp4',
  subtitleBurnIn: 'ass' | 'srt' | 'none' = 'ass',
) {
  const res = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, format, subtitle_burn_in: subtitleBurnIn }),
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

export async function exportAss(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/export/ass/${projectId}`);
  if (!res.ok) throw new Error(`Failed to export ASS: ${res.statusText}`);
  const blob = await res.blob();
  _triggerDownload(blob, `${projectId}.ass`);
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

// ── Subtitle Style Presets ──────────────────────────────

import type { SubtitleStyle } from '@mrdv2/shared';

export async function fetchSubtitlePresets(): Promise<{ presets: Record<string, SubtitleStyle> }> {
  const res = await fetch(`${API_BASE}/styles`);
  if (!res.ok) throw new Error(`Failed to fetch presets: ${res.statusText}`);
  return res.json();
}

export async function upsertSubtitlePreset(
  name: string,
  style: Partial<SubtitleStyle>,
): Promise<{ name: string; style: SubtitleStyle }> {
  const res = await fetch(`${API_BASE}/styles/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(style),
  });
  if (!res.ok) throw new Error(`Failed to save preset: ${res.statusText}`);
  return res.json();
}

export async function deleteSubtitlePreset(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/styles/${name}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete preset: ${res.statusText}`);
}

export async function sendChatMessage(message: string, projectId: string, signal?: AbortSignal) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, project_id: projectId }),
    signal,
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.statusText}`);
  return res.json();
}
