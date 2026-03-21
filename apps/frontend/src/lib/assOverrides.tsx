import React from 'react';

/**
 * Parse ASS override tags in subtitle text and return React elements.
 *
 * Supported tags:
 *   {\b1} / {\b0}  — bold on/off
 *   {\i1} / {\i0}  — italic on/off
 *   {\u1} / {\u0}  — underline on/off
 *   {\s1} / {\s0}  — strikethrough on/off
 *
 * Tags can be combined in a single block: {\b1\s1}
 * Unknown tags are silently ignored.
 * Text without any override tags is returned as-is (string, not wrapped in elements).
 */

interface OverrideState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

// Matches a single override tag block: { ... }
// Inside, one or more \X0 or \X1 commands
const TAG_BLOCK_RE = /\{([^}]*)\}/g;
// Individual commands inside a block
const CMD_RE = /\\([bius])([01])/g;

function applyCommands(block: string, state: OverrideState): void {
  let m: RegExpExecArray | null;
  CMD_RE.lastIndex = 0;
  while ((m = CMD_RE.exec(block)) !== null) {
    const on = m[2] === '1';
    switch (m[1]) {
      case 'b': state.bold = on; break;
      case 'i': state.italic = on; break;
      case 'u': state.underline = on; break;
      case 's': state.strikethrough = on; break;
    }
  }
}

function stateToStyle(state: OverrideState): React.CSSProperties | undefined {
  const decorations: string[] = [];
  if (state.underline) decorations.push('underline');
  if (state.strikethrough) decorations.push('line-through');

  const hasStyle = state.bold || state.italic || decorations.length > 0;
  if (!hasStyle) return undefined;

  return {
    ...(state.bold && { fontWeight: 'bold' }),
    ...(state.italic && { fontStyle: 'italic' }),
    ...(decorations.length > 0 && { textDecoration: decorations.join(' ') }),
  };
}

export function parseAssOverrides(text: string): React.ReactNode {
  // Fast path: no override tags at all
  if (!text.includes('{\\')) return text;

  const segments: React.ReactNode[] = [];
  const state: OverrideState = { bold: false, italic: false, underline: false, strikethrough: false };
  let lastIndex = 0;
  let key = 0;

  let m: RegExpExecArray | null;
  TAG_BLOCK_RE.lastIndex = 0;
  while ((m = TAG_BLOCK_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before) {
      const style = stateToStyle(state);
      segments.push(style ? <span key={key++} style={style}>{before}</span> : before);
    }

    applyCommands(m[1], state);
    lastIndex = m.index + m[0].length;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    const style = stateToStyle(state);
    segments.push(style ? <span key={key++} style={style}>{tail}</span> : tail);
  }

  return segments.length === 1 ? segments[0] : <>{segments}</>;
}

/**
 * Strip ASS override tags from text, returning plain text.
 * Useful for length calculations and accessible labels.
 */
export function stripAssOverrides(text: string): string {
  return text.replace(TAG_BLOCK_RE, '');
}
