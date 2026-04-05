import { useRef, useEffect } from 'react';
import type { TimelineProject } from '@mrdv2/shared';
import { useAppStore } from '../../stores/appStore';
import {
  TRACK_HEIGHT,
  HEADER_WIDTH,
  RULER_HEIGHT,
} from './timelineConstants';
import {
  zinc950, zinc900, zinc800, zinc400,
  blue500, red500, amber400,
  trackLaneEven, trackLaneOdd,
} from '../../theme';
import type { InsertIndicator } from './useTimelineDrag';

interface TimelineCanvasProps {
  timeline: TimelineProject;
  totalDuration: number;
  pixelsPerSec: number;
  snapGuideTime: number | null;
  insertIndicator: InsertIndicator | null;
  canvasWidth: number;
  height: number;
  scrollTop: number;
  scrollLeft: number;
  viewportWidth: number;
}

export default function TimelineCanvas({
  timeline,
  totalDuration,
  pixelsPerSec,
  snapGuideTime,
  insertIndicator,
  canvasWidth,
  height,
  scrollTop,
  scrollLeft,
  viewportWidth,
}: TimelineCanvasProps) {
  const currentFrame = useAppStore(s => s.currentFrame);
  const currentTime = currentFrame / (timeline.project.fps || 30);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size canvas to viewport only (not full content width) to stay within
    // browser canvas size limits. Firefox caps at ~16384px per dimension.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewportWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Translate so all drawing uses content-space coordinates.
    // The canvas element is positioned at scrollLeft, so translating by
    // -scrollLeft maps content coords into the viewport-sized canvas.
    ctx.translate(-scrollLeft, 0);

    // Background
    ctx.fillStyle = zinc950;
    ctx.fillRect(scrollLeft, 0, viewportWidth, height);

    // Ruler background
    ctx.fillStyle = zinc900;
    ctx.fillRect(Math.max(HEADER_WIDTH, scrollLeft), 0, viewportWidth, RULER_HEIGHT);

    // Ruler ticks and labels — only draw visible ones
    ctx.strokeStyle = zinc800;
    ctx.lineWidth = 1;
    ctx.fillStyle = zinc400;
    ctx.font = '10px monospace';

    const visibleStart = Math.max(0, Math.floor((scrollLeft - HEADER_WIDTH) / pixelsPerSec));
    const visibleEnd = Math.min(totalDuration, Math.ceil((scrollLeft + viewportWidth - HEADER_WIDTH) / pixelsPerSec));

    for (let t = visibleStart; t <= visibleEnd; t++) {
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

    // Clip region for track area (below ruler) to prevent tracks from drawing over ruler
    ctx.save();
    ctx.beginPath();
    ctx.rect(scrollLeft, RULER_HEIGHT, viewportWidth, height - RULER_HEIGHT);
    ctx.clip();

    // Track headers and lane backgrounds (offset by scrollTop)
    timeline.tracks.forEach((track, i) => {
      const y = RULER_HEIGHT + i * TRACK_HEIGHT - scrollTop;

      // Header background
      ctx.fillStyle = zinc900;
      ctx.fillRect(scrollLeft, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = zinc800;
      ctx.strokeRect(scrollLeft, y, HEADER_WIDTH, TRACK_HEIGHT);

      // Track lane background
      ctx.fillStyle = i % 2 === 0 ? trackLaneEven : trackLaneOdd;
      ctx.fillRect(Math.max(HEADER_WIDTH, scrollLeft), y, viewportWidth, TRACK_HEIGHT);
    });

    // Snap guide line
    if (snapGuideTime !== null) {
      const snapX = HEADER_WIDTH + snapGuideTime * pixelsPerSec;
      ctx.strokeStyle = amber400;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(snapX, RULER_HEIGHT);
      ctx.lineTo(snapX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Insert indicator (Alt+drag ripple insert)
    if (insertIndicator) {
      const ix = HEADER_WIDTH + insertIndicator.timeSec * pixelsPerSec;
      const iy = RULER_HEIGHT + insertIndicator.trackIndex * TRACK_HEIGHT - scrollTop;
      ctx.strokeStyle = blue500;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix, iy + TRACK_HEIGHT);
      ctx.stroke();
      // Top triangle
      ctx.fillStyle = blue500;
      ctx.beginPath();
      ctx.moveTo(ix - 5, iy);
      ctx.lineTo(ix + 5, iy);
      ctx.lineTo(ix, iy + 6);
      ctx.closePath();
      ctx.fill();
      // Bottom triangle
      ctx.beginPath();
      ctx.moveTo(ix - 5, iy + TRACK_HEIGHT);
      ctx.lineTo(ix + 5, iy + TRACK_HEIGHT);
      ctx.lineTo(ix, iy + TRACK_HEIGHT - 6);
      ctx.closePath();
      ctx.fill();
    }

    // Playhead line in track area
    const playheadX = HEADER_WIDTH + currentTime * pixelsPerSec;
    if (playheadX >= HEADER_WIDTH) {
      ctx.strokeStyle = red500;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, RULER_HEIGHT);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }

    ctx.restore();

    // Playhead triangle on ruler (outside clip region so always visible)
    if (playheadX >= HEADER_WIDTH) {
      ctx.fillStyle = red500;
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 8);
      ctx.closePath();
      ctx.fill();

      // Playhead line through ruler
      ctx.strokeStyle = red500;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, RULER_HEIGHT);
      ctx.stroke();
    }
  }, [timeline, currentTime, totalDuration, pixelsPerSec, snapGuideTime, insertIndicator, canvasWidth, height, scrollTop, scrollLeft, viewportWidth]);

  return (
    <canvas
      ref={canvasRef}
      className="block absolute top-0 pointer-events-none"
      style={{ left: scrollLeft }}
    />
  );
}
