import { useState, useEffect } from 'react';

export interface WaveformData {
  peaks: number[];
  duration: number;
  /** Temporal resolution — how many peaks per second of audio */
  peaksPerSec: number;
}

/**
 * Module-level cache: one entry per media file path.
 * Key: absolute file path. Value: full waveform data at fixed temporal resolution.
 */
const cache = new Map<string, WaveformData>();
const pending = new Map<string, Promise<WaveformData>>();
const MAX_CACHE = 50;

const PEAKS_PER_SEC = 100;

async function fetchWaveform(mediaFilePath: string): Promise<WaveformData> {
  const url = `/api/media/waveform?path=${encodeURIComponent(mediaFilePath)}&peaks_per_sec=${PEAKS_PER_SEC}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Waveform fetch failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return {
    peaks: data.peaks,
    duration: data.duration,
    peaksPerSec: data.peaks_per_sec ?? PEAKS_PER_SEC,
  };
}

/**
 * Fetches and caches waveform data for a media file.
 *
 * Best practice: one fetch per media file at a fixed temporal resolution
 * (100 peaks/sec). The AudioWaveform component handles slicing by source
 * range and downsampling to pixel width. This means:
 * - Zoom changes don't trigger refetches
 * - Multiple clips from the same media share one peaks array
 * - Resolution scales with media duration (not fixed 800 peaks)
 */
export function useAudioWaveform(
  mediaFilePath: string | null,
): {
  waveformData: WaveformData | null;
  loading: boolean;
} {
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mediaFilePath) {
      setWaveformData(null);
      setLoading(false);
      return;
    }

    const cached = cache.get(mediaFilePath);
    if (cached) {
      setWaveformData(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    let promise = pending.get(mediaFilePath);
    if (!promise) {
      promise = fetchWaveform(mediaFilePath);
      pending.set(mediaFilePath, promise);
    }

    promise
      .then((data) => {
        // Evict oldest if cache too large
        if (cache.size >= MAX_CACHE) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(mediaFilePath, data);
        pending.delete(mediaFilePath);
        if (!cancelled) {
          setWaveformData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn(`[waveform] Failed to load waveform for ${mediaFilePath}:`, err.message);
        pending.delete(mediaFilePath);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaFilePath]);

  return { waveformData, loading };
}
