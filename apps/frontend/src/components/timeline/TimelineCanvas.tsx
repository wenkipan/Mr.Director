import { useRef, useEffect } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import {
  TRACK_HEIGHT,
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_COLORS,
} from './timelineConstants';

interface TimelineCanvasProps {
  timeline: TimelineProject;
  currentTime: number;
  totalDuration: number;
  pixelsPerSec: number;
  snapGuideTime: number | null;
  canvasWidth: number;
  height: number;
}

export default function TimelineCanvas({
  timeline,
  currentTime,
  totalDuration,
  pixelsPerSec,
  snapGuideTime,
  canvasWidth,
  height,
}: TimelineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvasWidth, height);

    // Ruler background
    ctx.fillStyle = '#27272a';
    ctx.fillRect(HEADER_WIDTH, 0, canvasWidth - HEADER_WIDTH, RULER_HEIGHT);

    // Ruler ticks and labels
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '10px monospace';

    for (let t = 0; t <= totalDuration; t++) {
      const x = HEADER_WIDTH + t * pixelsPerSec;

      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 8);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();

      const label =
        t < 60
          ? `${t}s`
          : `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
      ctx.fillText(label, x + 3, RULER_HEIGHT - 12);

      // Half-second ticks
      const halfX = x + pixelsPerSec / 2;
      ctx.beginPath();
      ctx.moveTo(halfX, RULER_HEIGHT - 4);
      ctx.lineTo(halfX, RULER_HEIGHT);
      ctx.stroke();
    }

    // Track headers and lane backgrounds
    timeline.tracks.forEach((track, i) => {
      const y = RULER_HEIGHT + i * TRACK_HEIGHT;

      // Header background
      ctx.fillStyle = '#27272a';
      ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = '#3f3f46';
      ctx.strokeRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);

      // Track lane background
      ctx.fillStyle = i % 2 === 0 ? '#1c1c20' : '#202024';
      ctx.fillRect(HEADER_WIDTH, y, canvasWidth - HEADER_WIDTH, TRACK_HEIGHT);
    });

    // Snap guide line
    if (snapGuideTime !== null) {
      const snapX = HEADER_WIDTH + snapGuideTime * pixelsPerSec;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(snapX, 0);
      ctx.lineTo(snapX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Playhead
    const playheadX = HEADER_WIDTH + currentTime * pixelsPerSec;
    if (playheadX >= HEADER_WIDTH) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Playhead triangle
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [timeline, currentTime, totalDuration, pixelsPerSec, snapGuideTime, canvasWidth, height]);

  return (
    <canvas
      ref={canvasRef}
      className="block absolute top-0 left-0 pointer-events-none"
    />
  );
}
