// /compact — Phase WF6.
//
// Summarises the current conversation via an LLM call, appends the
// summary to MEMORY.md's "Recent work" section, and returns a compact
// handle the dashboard uses to reset chat.history and seed the next
// session. Also called by ExitPlanMode's "handoff" path to transfer
// the drafted plan into a fresh session.

import { streamLLM, type LLMMessage } from '../llm.js';

const COMPACT_SYSTEM_PROMPT = `
You are performing a CONTEXT CHECKPOINT COMPACTION for another agent
that will resume this work.

First, think in a private <analysis>...</analysis> scratchpad about
the transcript's true goal, constraints, discoveries, and unfinished
work. Then emit only the final compact summary. Do not mention the
scratchpad.

Write the final summary in plain text with exactly these sections:

## Goal
- what the user asked for, including scope changes or constraints

## Instructions
- explicit user preferences, approvals, prohibitions, or process rules

## Discoveries
- facts learned from reading code, docs, tool output, or debugging

## Accomplished
- concrete work already completed, including files edited or decisions made

## Relevant files / directories
- short path-oriented list with why each matters

Rules:
- Be concise and resume-oriented.
- No preamble, no markdown code fences, no meta commentary.
- Preserve important exact strings only when they matter for continuing.
`.trim();

export interface CompactOptions {
  /** How many trailing turns to keep after summarisation (besides the
   *  system messages which are always preserved). 0 = no raw turns
   *  kept, only the summary. Default 2 so the last user + assistant
   *  pair remains in-context for continuity. */
  preserveLastN?: number;
  /** Override the summariser's target model. When omitted, the same
   *  provider the chat loop is using picks up. */
  model?: string;
  /** Maximum seconds to wait for the summary — on timeout we return
   *  null and callers decide whether to abort /compact or proceed
   *  with an empty summary. Default 45s. */
  timeoutMs?: number;
}

export interface CompactResult {
  summary: string;
  /** How many source turns were folded in. */
  sourceTurns: number;
}

export interface CompactPartialOptions extends CompactOptions {
  /** Inclusive history index through which messages are compacted. */
  upToIndex: number;
}

export function getCompactSystemPrompt(): string {
  return COMPACT_SYSTEM_PROMPT;
}

export function buildCompactTranscript(
  history: readonly LLMMessage[],
): string {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const content = typeof m.content === 'string'
        ? m.content
        : (m.content as any[])
          .filter((b) => b?.type === 'text')
          .map((b) => (b as any).text)
          .join('\n');
      return `${m.role.toUpperCase()}: ${content}`;
    })
    .join('\n\n');
}

export function stripCompactScratchpad(text: string): string {
  return text.replace(/<analysis>[\s\S]*?<\/analysis>\s*/gi, '').trim();
}

function nonSystemCount(history: readonly LLMMessage[]): number {
  return history.filter((m) => m.role !== 'system').length;
}

async function compactHistorySlice(
  history: readonly LLMMessage[],
  opts: CompactOptions = {},
): Promise<CompactResult> {
  const sourceTurns = nonSystemCount(history);
  if (sourceTurns === 0) {
    return { summary: '', sourceTurns: 0 };
  }

  const textTurns = buildCompactTranscript(history);
  const req: LLMMessage[] = [
    { role: 'system', content: COMPACT_SYSTEM_PROMPT },
    { role: 'user', content: `Transcript to summarise:\n\n${textTurns}` },
  ];

  let text = '';
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
  try {
    text = await streamLLM(req, () => { /* no live echo */ }, {
      ...(opts.model ? { model: opts.model } : {}),
    });
  } catch (err) {
    throw new Error(`compact summarise failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (Date.now() > deadline) {
    throw new Error('compact summarise timed out');
  }

  return { summary: stripCompactScratchpad(text), sourceTurns };
}

export async function compactConversation(
  history: readonly LLMMessage[],
  opts: CompactOptions = {},
): Promise<CompactResult> {
  return compactHistorySlice(history, opts);
}

export async function compactConversationPartial(
  history: readonly LLMMessage[],
  opts: CompactPartialOptions,
): Promise<CompactResult> {
  if (opts.upToIndex < 0) {
    return { summary: '', sourceTurns: 0 };
  }
  return compactHistorySlice(history.slice(0, opts.upToIndex + 1), opts);
}
