import { useRef, useEffect, useMemo } from 'react';
import type { TimelineProject } from '@mrdv2/shared';

interface TimelineEditorProps {
  timeline: TimelineProject;
  currentTime: number; // seconds
  onSeek: (timeSec: number) => void;
}

const TRACK_HEIGHT = 40;
const HEADER_WIDTH = 120;
const PIXELS_PER_SEC = 80;

const TRACK_COLORS: Record<string, string> = {
  video: '#3b82f6',
  audio: '#22c55e',
  subtitle: '#eab308',
};

export default function TimelineEditor({ timeline, currentTime, onSeek }: TimelineEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalDuration = useMemo(() => {
    let max = 1;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const end = clip.timeline_start_sec + clip.duration_sec;
        if (end > max) max = end;
      }
    }
    return max + 2; // add 2s padding
  }, [timeline]);

  // Convert vertical mouse wheel to horizontal scroll
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        scrollEl.scrollLeft += e.deltaY;
      }
    };

    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', onWheel);
  }, []);

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const playheadX = HEADER_WIDTH + currentTime * PIXELS_PER_SEC;
    const { scrollLeft, clientWidth } = scrollEl;
    const visibleLeft = scrollLeft;
    const visibleRight = scrollLeft + clientWidth;

    // Scroll when playhead is near the right edge or past it
    const margin = clientWidth * 0.15;
    if (playheadX > visibleRight - margin) {
      scrollEl.scrollLeft = playheadX - clientWidth * 0.3;
    } else if (playheadX < visibleLeft + HEADER_WIDTH) {
      scrollEl.scrollLeft = Math.max(0, playheadX - HEADER_WIDTH - margin);
    }
  }, [currentTime]);

  // Draw timeline
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const h = container.clientHeight;
    const canvasWidth = Math.max(
      container.clientWidth,
      HEADER_WIDTH + totalDuration * PIXELS_PER_SEC,
    );

    canvas.width = canvasWidth * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const tracksStartY = 30; // ruler height

    // Background
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvasWidth, h);

    // Ruler
    ctx.fillStyle = '#27272a';
    ctx.fillRect(HEADER_WIDTH, 0, canvasWidth - HEADER_WIDTH, tracksStartY);
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '10px monospace';

    for (let t = 0; t <= totalDuration; t++) {
      const x = HEADER_WIDTH + t * PIXELS_PER_SEC;

      ctx.beginPath();
      ctx.moveTo(x, tracksStartY - 8);
      ctx.lineTo(x, tracksStartY);
      ctx.stroke();

      const label = t < 60 ? `${t}s` : `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
      ctx.fillText(label, x + 3, tracksStartY - 12);

      // Half-second ticks
      const halfX = x + PIXELS_PER_SEC / 2;
      ctx.beginPath();
      ctx.moveTo(halfX, tracksStartY - 4);
      ctx.lineTo(halfX, tracksStartY);
      ctx.stroke();
    }

    // Track headers and clip blocks
    timeline.tracks.forEach((track, i) => {
      const y = tracksStartY + i * TRACK_HEIGHT;

      // Header background
      ctx.fillStyle = '#27272a';
      ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = '#3f3f46';
      ctx.strokeRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);

      // Header text
      ctx.fillStyle = '#d4d4d8';
      ctx.font = '11px sans-serif';
      const label = track.name || `${track.type[0].toUpperCase()}${track.type.slice(1)}`;
      ctx.fillText(label, 8, y + TRACK_HEIGHT / 2 + 4);

      // Track lane background
      ctx.fillStyle = i % 2 === 0 ? '#1c1c20' : '#202024';
      ctx.fillRect(HEADER_WIDTH, y, canvasWidth - HEADER_WIDTH, TRACK_HEIGHT);

      // Clips
      const color = TRACK_COLORS[track.type] || '#6b7280';
      for (const clip of track.clips) {
        const cx = HEADER_WIDTH + clip.timeline_start_sec * PIXELS_PER_SEC;
        const cw = clip.duration_sec * PIXELS_PER_SEC;
        const cy = y + 4;
        const ch = TRACK_HEIGHT - 8;

        // Clip body
        ctx.fillStyle = color + '99'; // with alpha
        ctx.beginPath();
        ctx.roundRect(cx, cy, Math.max(cw, 2), ch, 3);
        ctx.fill();

        // Clip border
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Clip label
        if (cw > 40) {
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          const clipLabel =
            clip.type === 'subtitle'
              ? clip.subtitle_text?.slice(0, 20) || 'Sub'
              : clip.media_id || clip.id;
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx + 2, cy, cw - 4, ch);
          ctx.clip();
          ctx.fillText(clipLabel, cx + 6, cy + ch / 2 + 3);
          ctx.restore();
        }
      }
    });

    // Playhead
    const playheadX = HEADER_WIDTH + currentTime * PIXELS_PER_SEC;
    if (playheadX >= HEADER_WIDTH) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
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
  }, [timeline, currentTime, totalDuration]);

  // Click to seek
  const handleClick = (e: React.MouseEvent) => {
    const scrollEl = scrollRef.current;
    const canvas = canvasRef.current;
    if (!scrollEl || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - HEADER_WIDTH;
    if (x < 0) return;
    const timeSec = x / PIXELS_PER_SEC;
    onSeek(Math.max(0, timeSec));
  };

  return (
    <div ref={containerRef} className="w-full h-full">
      <div ref={scrollRef} className="w-full h-full overflow-x-auto overflow-y-hidden cursor-pointer">
        <canvas ref={canvasRef} onClick={handleClick} className="block" />
      </div>
    </div>
  );
}
