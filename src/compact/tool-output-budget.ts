// ── Wave 2 · Layer 1 · tool-output budget (no LLM) ──────────────────
//
// Gemini `chatCompressionService.truncateHistoryToBudget` analogue.
// For each `tool_result` ContentBlock in the conversation, when its
// content exceeds `policy.toolOutputCharBudget` chars, replace the
// head with a file pointer ("Full output saved to: <path>") and
// preserve the last `policy.toolOutputTailLines` lines verbatim.
// The full original is appended to the JSONL archive.
//
// Skips messages in the preserve-last-N window so the most recent
// tool calls (which the model is actively reasoning about) stay
// fully visible.

import type { ContentBlock, LLMMessage } from '../llm.js';
import {
  appendArchiveEntry,
  archivePath,
  getDefaultArchiveDir,
} from './archive.js';
import { DEFAULT_COMPACT_POLICY, type CompactPolicy } from './types.js';

export interface ToolOutputBudgetOpts {
  policy?: Partial<CompactPolicy>;
  sessionId?: string;
  /** Override `Date.now()` — tests inject so timestamps are stable. */
  now?: () => number;
}

export interface ToolOutputBudgetResult {
  messages: LLMMessage[];
  responsesTrimmed: number;
  savedChars: number;
}

export function applyToolOutputBudget(
  messages: LLMMessage[],
  opts: ToolOutputBudgetOpts = {},
): ToolOutputBudgetResult {
  const policy = { ...DEFAULT_COMPACT_POLICY, ...opts.policy };
  const sessionId = opts.sessionId ?? 'default';
  const now = opts.now ?? Date.now;
  const archiveDir = policy.archiveDir ?? getDefaultArchiveDir();

  const preserveFromIdx = Math.max(0, messages.length - policy.preserveLastN);
  const out: LLMMessage[] = [];
  let responsesTrimmed = 0;
  let savedChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (i >= preserveFromIdx || typeof msg.content === 'string') {
      out.push(msg);
      continue;
    }
    const blocks = msg.content as ContentBlock[];
    let mutated = false;
    const newBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (block.type !== 'tool_result' || typeof block.content !== 'string' || block.content.length <= policy.toolOutputCharBudget) {
        newBlocks.push(block);
        continue;
      }
      // Trim — keep tail N lines + emit file pointer.
      const tailLines = block.content
        .split('\n')
        .slice(-policy.toolOutputTailLines)
        .join('\n');
      const replacementPath = policy.archiveEnabled
        ? archivePath(sessionId, archiveDir)
        : '<archive disabled>';
      const replacement =
        `[Full output (${block.content.length} chars) saved to: ${replacementPath}]\n` +
        `[Last ${policy.toolOutputTailLines} lines preserved below]\n` +
        tailLines;

      if (policy.archiveEnabled) {
        appendArchiveEntry(
          {
            ts: now(),
            layer: 'tool-output-budget',
            sessionId,
            origin: { kind: 'tool_result', tool_use_id: block.tool_use_id },
            content: block.content,
            replacement,
          },
          archiveDir,
        );
      }
      savedChars += block.content.length - replacement.length;
      responsesTrimmed += 1;
      mutated = true;
      newBlocks.push({ ...block, content: replacement });
    }
    out.push(mutated ? { ...msg, content: newBlocks } : msg);
  }

  return { messages: out, responsesTrimmed, savedChars };
}
