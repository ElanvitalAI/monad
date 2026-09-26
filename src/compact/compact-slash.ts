// ── Wave 3 · /compact slash command ───────────────────────────────
//
// User-facing trigger for the no-LLM Layer 1+2 pipeline. The chat
// surface invokes `runCompactSlash()` with the current conversation
// + active model id; the slash returns the new message array, the
// before/after token estimate, and human-readable status lines.
//
// Wave 4 will extend this with `--llm` (or auto-fallback) to chain
// Layer 3 summarization. Wave 5 wires the auto trigger.

import type { LLMMessage } from '../llm.js';
import { estimateMessagesTokens } from '../tokens.js';
import { runCompactPipeline, type RunCompactOpts } from './pipeline.js';
import { type CompactPipelineResult } from './types.js';

export interface CompactSlashCommandDescriptor {
  name: string;
  aliases: string[];
  description: string;
}

export function buildCompactSlashCommand(): CompactSlashCommandDescriptor {
  return {
    name: 'compact',
    aliases: ['compress', 'squeeze'],
    description:
      'Trim huge tool outputs (Layer 1) + clear old tool results (Layer 2). No LLM call. Archive saved to ~/.elanous/compact-archive/.',
  };
}

export interface CompactSlashRunArgs extends RunCompactOpts {
  messages: LLMMessage[];
}

export interface CompactSlashRunResult {
  messages: LLMMessage[];
  pipeline: CompactPipelineResult;
  /** Estimated input-token delta. Used by the slash response and by
   *  Wave 5 auto-compact to decide whether to escalate to Layer 3. */
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  /** Multi-line status block formatted for the chat surface. */
  statusLines: string[];
}

/** Run the slash. Async because Wave 4's Layer 3 (LLM summarize)
 *  is awaited when a `provider` is supplied; Layers 1+2 alone resolve
 *  on the next microtask. No IO outside the archive write inside
 *  the pipeline (best-effort). */
export async function runCompactSlash(
  args: CompactSlashRunArgs,
): Promise<CompactSlashRunResult> {
  const beforeTokens = estimateMessagesTokens(args.messages);
  const pipeline = await runCompactPipeline(args.messages, args);
  const afterTokens = estimateMessagesTokens(pipeline.messages);
  const savedTokens = Math.max(0, beforeTokens - afterTokens);

  const lines: string[] = [];
  lines.push('── /compact ─────────────────────────────────────────────');
  lines.push(`Layer 1 (tool-output budget): ${pipeline.diagnostics.layer1ResponsesTrimmed} response(s) trimmed · ${formatChars(pipeline.diagnostics.layer1ToolOutputBudgetSavedChars)} chars saved`);
  lines.push(`Layer 2 (microcompact):       ${pipeline.diagnostics.layer2MicrocompactCleared} tool result(s) cleared · ${formatChars(pipeline.diagnostics.layer2MicrocompactSavedChars)} chars saved`);
  if (pipeline.diagnostics.layer3SummaryApplied) {
    lines.push(`Layer 3 (LLM summarize):      ${pipeline.diagnostics.layer3SummaryModel || '(active model)'} produced ${formatChars(pipeline.diagnostics.layer3SummaryChars)} char summary`);
  }
  if (pipeline.diagnostics.archived > 0) {
    lines.push(`Archived ${pipeline.diagnostics.archived} chunk(s) to ~/.elanous/compact-archive/${args.sessionId ?? 'default'}.jsonl`);
  }
  lines.push('');
  lines.push(`Tokens: ${formatTokenNumber(beforeTokens)} → ${formatTokenNumber(afterTokens)}  (saved ${formatTokenNumber(savedTokens)})`);
  if (savedTokens === 0 && !pipeline.diagnostics.layer3SummaryApplied) {
    lines.push('');
    lines.push('No reduction — try widening preserveLastN or microcompactAgeThreshold,');
    lines.push('or pass a provider to chain a Layer 3 LLM summary (Wave 4).');
  }

  return {
    messages: pipeline.messages,
    pipeline,
    beforeTokens,
    afterTokens,
    savedTokens,
    statusLines: lines,
  };
}

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatTokenNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tok`;
  return `${n} tok`;
}
