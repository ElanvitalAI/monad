// ── Wave 2 · Layer 2 · microcompact (no LLM) ──────────────────────
//
// Claude `microCompact.ts` analogue. Walk the conversation from the
// oldest end; replace `tool_result` content with the placeholder
// `[Old tool result content cleared]` for any result that's older
// than `policy.microcompactAgeThreshold` turns ago. Always preserve
// the last `policy.preserveLastN` messages verbatim.
//
// Counts a "turn" as any message with role 'user' or 'assistant'.
// The threshold compares the message's turn-distance from the tail.

import type { ContentBlock, LLMMessage } from '../llm.js';
import {
  appendArchiveEntry,
  getDefaultArchiveDir,
} from './archive.js';
import { DEFAULT_COMPACT_POLICY, type CompactPolicy } from './types.js';

const MICROCOMPACT_PLACEHOLDER = '[Old tool result content cleared]';

export interface MicrocompactOpts {
  policy?: Partial<CompactPolicy>;
  sessionId?: string;
  now?: () => number;
}

export interface MicrocompactResult {
  messages: LLMMessage[];
  cleared: number;
  savedChars: number;
}

export function applyMicrocompact(
  messages: LLMMessage[],
  opts: MicrocompactOpts = {},
): MicrocompactResult {
  const policy = { ...DEFAULT_COMPACT_POLICY, ...opts.policy };
  const sessionId = opts.sessionId ?? 'default';
  const now = opts.now ?? Date.now;
  const archiveDir = policy.archiveDir ?? getDefaultArchiveDir();

  // Determine the cut-off message index. Anything before
  // `cutoffIdx` is eligible for clearing. Default rule: count the
  // last `microcompactAgeThreshold` user/assistant turns from the
  // tail; everything before that is "old".
  let cutoffIdx = 0;
  let turnCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' || m.role === 'assistant') {
      turnCount += 1;
      if (turnCount > policy.microcompactAgeThreshold) {
        cutoffIdx = i + 1;
        break;
      }
    }
  }
  // Also enforce preserveLastN — never clear messages in that window.
  const preserveFromIdx = Math.max(0, messages.length - policy.preserveLastN);
  const effectiveCutoff = Math.min(cutoffIdx, preserveFromIdx);

  const out: LLMMessage[] = [];
  let cleared = 0;
  let savedChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (i >= effectiveCutoff || typeof msg.content === 'string') {
      out.push(msg);
      continue;
    }
    const blocks = msg.content as ContentBlock[];
    let mutated = false;
    const newBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (
        block.type !== 'tool_result'
        || typeof block.content !== 'string'
        || block.content === MICROCOMPACT_PLACEHOLDER
      ) {
        // Array content (image tool_result) is opaque to microcompact —
        // the bytes were sent for vision input and shouldn't be silently
        // dropped. Tool-output-budget already skips them; this guard
        // keeps microcompact aligned.
        newBlocks.push(block);
        continue;
      }
      // Tool result eligible for clearing.
      if (policy.archiveEnabled) {
        appendArchiveEntry(
          {
            ts: now(),
            layer: 'microcompact',
            sessionId,
            origin: { kind: 'tool_result', tool_use_id: block.tool_use_id },
            content: block.content,
            replacement: MICROCOMPACT_PLACEHOLDER,
          },
          archiveDir,
        );
      }
      cleared += 1;
      savedChars += block.content.length - MICROCOMPACT_PLACEHOLDER.length;
      mutated = true;
      newBlocks.push({ ...block, content: MICROCOMPACT_PLACEHOLDER });
    }
    out.push(mutated ? { ...msg, content: newBlocks } : msg);
  }

  return { messages: out, cleared, savedChars };
}
