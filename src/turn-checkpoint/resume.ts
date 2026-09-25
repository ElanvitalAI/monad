// PLAN §4.1 · Phase 1.1 — `/resume` seed formatter.
//
// Takes a `TurnCheckpoint` and produces the user-message text the
// dashboard prefills into the input editor when the user invokes
// `/resume`. The user reviews + Enter to submit so the seed becomes a
// normal user turn — no LLM is auto-engaged here.

import type { TurnCheckpoint } from './types.js';

const SUFFIX_LEN = 12;

function shortTurn(turnUri: string): string {
  return turnUri.length > SUFFIX_LEN ? turnUri.slice(-SUFFIX_LEN) : turnUri;
}

export function formatResumeSeed(cp: TurnCheckpoint): string {
  const lines: string[] = [];
  lines.push(`[resume turn ${shortTurn(cp.turnUri)} · checkpoint #${cp.toolIndex} · ${cp.decision.kind}]`);
  lines.push(`Last decision: ${cp.decision.preview}`);
  if (cp.loop.signal?.primarySourceFile) {
    lines.push(`Primary source: ${cp.loop.signal.primarySourceFile}`);
  }
  if (cp.loop.signal?.primaryTestFile) {
    lines.push(`Primary test: ${cp.loop.signal.primaryTestFile}`);
  }
  if (cp.loop.verification?.lastCommand) {
    const verdict = cp.loop.verification.lastSummary ?? 'unknown';
    lines.push(`Last verify: ${cp.loop.verification.lastCommand} → ${verdict}`);
  }
  if (cp.loop.execution?.lastCommand) {
    lines.push(`Last execution: ${cp.loop.execution.lastCommand}`);
  }
  if (cp.recentText) {
    const snippet = cp.recentText.replace(/\s+/g, ' ').trim();
    if (snippet.length > 0) {
      lines.push(`Recent assistant text: ${snippet.slice(0, 200)}`);
    }
  }
  lines.push('');
  lines.push('Restate the next planned step in one line, then proceed.');
  return lines.join('\n');
}
