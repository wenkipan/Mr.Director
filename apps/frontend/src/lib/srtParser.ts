export interface SrtEntry {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Parse SRT timestamp "HH:MM:SS,mmm" to seconds.
 */
function parseTimestamp(ts: string): number {
  const [hms, ms] = ts.trim().split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + (parseInt(ms, 10) || 0) / 1000;
}

/**
 * Parse SRT file content into structured entries.
 */
export function parseSrt(content: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = content.trim().replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    if (isNaN(index)) continue;

    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!timeMatch) continue;

    entries.push({
      index,
      startSec: parseTimestamp(timeMatch[1]),
      endSec: parseTimestamp(timeMatch[2]),
      text: lines.slice(2).join('\n'),
    });
  }

  return entries;
}
