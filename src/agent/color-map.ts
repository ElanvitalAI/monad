// ── Agent color map ──
//
// Phase F1 — deterministic name-to-color mapping for log attribution.
// Two agents with different names get visibly distinct colors; the
// same name always gets the same color across runs.
//
// Palette picked from Catppuccin Mocha tones that DON'T collide with
// the semantic C.* slots (accent/success/warning/error/info/highlight).
// That way a red `[persona]` tag never gets confused with the error
// color attached to an actual error event on the same line.

import chalk from 'chalk';

/** Raw hex palette in pick order. Exported so tests can assert the
 *  exact mapping rather than brittle ANSI byte sequences. */
export const AGENT_PALETTE_HEX = [
  '#cba6f7',   // mauve
  '#b4befe',   // lavender
  '#f5c2e7',   // pink
  '#f2cdcd',   // flamingo
  '#fab387',   // peach
  '#f9e2af',   // yellow
  '#94e2d5',   // teal
  '#89dceb',   // sky
  '#74c7ec',   // sapphire
  '#89b4fa',   // blue
  '#eba0ac',   // maroon
  '#f5e0dc',   // rosewater
] as const;

const PALETTE = AGENT_PALETTE_HEX.map(hex => chalk.hex(hex));

/** FNV-1a 32-bit hash — fast, no deps, stable across JS engines. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;   // unsigned
}

/** Pick a stable palette index for `name`. Deterministic across
 *  processes: same input always maps to the same index. */
export function agentColorIndex(name: string): number {
  if (!name) return 0;
  return fnv1a(name) % PALETTE.length;
}

/** Return a chalk-backed color function for the agent. Apply it to
 *  any string — typically the `[name]` prefix on a log line. */
export function agentColor(name: string): (s: string) => string {
  return PALETTE[agentColorIndex(name)]!;
}

/** Identity-pass variant for tests / non-TTY environments that want
 *  deterministic output without ANSI bytes. */
export const agentColorNoop: (s: string) => string = s => s;
