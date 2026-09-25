// PLAN §4.4 · Phase 1.4 — Research result formatters.
//
// Two surfaces:
//   - formatResearchPrefill — the `<context>` block injected into
//     the next user input; the LLM treats it as cited material.
//   - formatResearchSummary — short status banner the slash mirrors
//     into the chat pane so the user sees what was archived.

import type { ExternalResearchResult } from './types.js';

const PREFILL_OUTPUT_CAP = 6000;

export function formatResearchSummary(r: ExternalResearchResult): string {
  const status = r.ok ? '✓' : '⚠';
  const seconds = (r.durationMs / 1000).toFixed(1);
  const len = r.output.length;
  const head = `${status} /research ${r.skill}: "${r.topic}" — ${seconds}s · ${len} chars`;
  if (r.error) return `${head}  (error: ${r.error.slice(0, 120)})`;
  return head;
}

export function formatResearchPrefill(r: ExternalResearchResult): string {
  const truncated = r.output.length > PREFILL_OUTPUT_CAP;
  const body = truncated ? r.output.slice(0, PREFILL_OUTPUT_CAP) + '\n\n…(truncated — see archive)' : r.output;
  const lines: string[] = [];
  lines.push('<external-research>');
  lines.push(`  <topic>${r.topic}</topic>`);
  lines.push(`  <skill>${r.skill}</skill>`);
  lines.push(`  <duration_ms>${r.durationMs}</duration_ms>`);
  lines.push(`  <ok>${r.ok}</ok>`);
  lines.push(`  <output>`);
  lines.push(body);
  lines.push(`  </output>`);
  lines.push('</external-research>');
  lines.push('');
  lines.push('Use the research above as cited context. Continue with: ');
  return lines.join('\n');
}
