import { useState, useEffect } from 'react';
import { getAudioData, type AudioData } from '@remotion/media-utils';

const cache = new Map<string, AudioData>();
const pending = new Map<string, Promise<AudioData>>();

export function useAudioWaveform(mediaUrl: string | null): {
  audioData: AudioData | null;
  loading: boolean;
} {
  const [audioData, setAudioData] = useState<AudioData | null>(
    mediaUrl ? cache.get(mediaUrl) ?? null : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mediaUrl) return;

    const cached = cache.get(mediaUrl);
    if (cached) {
      setAudioData(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    let promise = pending.get(mediaUrl);
    if (!promise) {
      promise = getAudioData(mediaUrl);
      pending.set(mediaUrl, promise);
    }

    promise
      .then((data) => {
        cache.set(mediaUrl, data);
        pending.delete(mediaUrl);
        if (!cancelled) {
          setAudioData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        pending.delete(mediaUrl);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaUrl]);

  return { audioData, loading };
}
