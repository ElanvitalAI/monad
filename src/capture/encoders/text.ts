// ── Capture Phase 0 — plain text encoder ──
//
// Strip ANSI SGR + common motion/OSC sequences from the input, leaving
// printable text + newlines. Uses the same stripSgrSequences /
// stripMotionSequences helpers that PreviewTerminal exports so the
// capture engine and the LLM-facing snapshot path agree on what
// "plain" means.

import { stripMotionSequences, stripSgrSequences } from '../../preview/terminal.js';

export function encodeText(input: string): string {
  return stripSgrSequences(stripMotionSequences(input));
}
