import { useRef, useEffect, useMemo } from 'react';
import { getWaveformPortion, type AudioData } from '@remotion/media-utils';

interface AudioWaveformProps {
  audioData: AudioData | null;
  sourceInSec: number;
  sourceOutSec: number;
  width: number;
  height: number;
  color: string;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_STEP = BAR_WIDTH + BAR_GAP;

export default function AudioWaveform({
  audioData,
  sourceInSec,
  sourceOutSec,
  width,
  height,
  color,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const numberOfSamples = Math.max(1, Math.ceil(width / BAR_STEP));
  const duration = sourceOutSec - sourceInSec;

  const bars = useMemo(() => {
    if (!audioData || duration <= 0) return null;
    try {
      return getWaveformPortion({
        audioData,
        startTimeInSeconds: sourceInSec,
        durationInSeconds: duration,
        numberOfSamples,
      });
    } catch {
      return null;
    }
  }, [audioData, sourceInSec, duration, numberOfSamples]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bars) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = color + 'cc'; // 80% opacity
    const centerY = height / 2;

    for (let i = 0; i < bars.length; i++) {
      const amplitude = bars[i].amplitude;
      const barHeight = amplitude * height * 0.9; // 90% max height
      const x = i * BAR_STEP;
      const halfBar = barHeight / 2;
      ctx.fillRect(x, centerY - halfBar, BAR_WIDTH, barHeight);
    }
  }, [bars, width, height, color]);

  if (!bars) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        pointerEvents: 'none',
      }}
    />
  );
}
