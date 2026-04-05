import { useRef, useEffect, useMemo } from 'react';
import type { WaveformData } from '../../hooks/useAudioWaveform';

interface AudioWaveformProps {
  waveformData: WaveformData;
  sourceInSec: number;
  sourceOutSec: number;
  width: number;
  height: number;
  color: string;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const MAX_CANVAS_WIDTH = 16000;

export default function AudioWaveform({
  waveformData,
  sourceInSec,
  sourceOutSec,
  width,
  height,
  color,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderWidth = Math.min(width, MAX_CANVAS_WIDTH);

  const bars = useMemo(() => {
    const { peaks, duration, peaksPerSec } = waveformData;
    if (!peaks.length || duration <= 0) return null;

    const clipDuration = sourceOutSec - sourceInSec;
    if (clipDuration <= 0) return null;

    // Temporal slicing: use peaksPerSec for precise index mapping
    const startIdx = Math.floor(sourceInSec * peaksPerSec);
    const endIdx = Math.ceil(sourceOutSec * peaksPerSec);
    const slicedPeaks = peaks.slice(
      Math.max(0, startIdx),
      Math.min(peaks.length, endIdx),
    );

    if (slicedPeaks.length === 0) return null;

    // Downsample to fit pixel width
    const numBars = Math.max(1, Math.ceil(renderWidth / BAR_STEP));
    const result: number[] = [];
    const chunkSize = slicedPeaks.length / numBars;

    for (let i = 0; i < numBars; i++) {
      const from = Math.floor(i * chunkSize);
      const to = Math.min(Math.floor((i + 1) * chunkSize), slicedPeaks.length);
      if (from >= to) {
        result.push(slicedPeaks[Math.min(from, slicedPeaks.length - 1)] ?? 0);
      } else {
        let max = 0;
        for (let j = from; j < to; j++) {
          if (slicedPeaks[j] > max) max = slicedPeaks[j];
        }
        result.push(max);
      }
    }

    return result;
  }, [waveformData, sourceInSec, sourceOutSec, renderWidth]);

  // Gate canvas redraws with rAF to coalesce rapid updates during trim drag
  const rafRef = useRef(0);
  useEffect(() => {
    if (!bars) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const physicalWidth = Math.min(renderWidth * dpr, 32000);
      const physicalHeight = height * dpr;
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scaleX = physicalWidth / renderWidth;
      const scaleY = physicalHeight / height;
      ctx.scale(scaleX, scaleY);
      ctx.clearRect(0, 0, renderWidth, height);

      // Use white bars with opacity for good contrast on any track color
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      const centerY = height / 2;

      for (let i = 0; i < bars.length; i++) {
        const amplitude = bars[i];
        const barHeight = Math.max(1, amplitude * height * 0.85);
        const x = i * BAR_STEP;
        const halfBar = barHeight / 2;
        ctx.fillRect(x, centerY - halfBar, BAR_WIDTH, barHeight);
      }
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [bars, renderWidth, height, color]);

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
