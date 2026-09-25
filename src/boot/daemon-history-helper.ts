// MVP cleanup C1 + C2 — shared history helpers for the daemon's
// "build a turn" path.
//
// Three callers (`daemon-runtime` ACP server bridge,
// `daemon-http-server` POST /v1/prompt, `daemon-public-server` POST
// /v1/prompt) all do the same thing:
//
//   1. Read prior history for sessionId.
//   2. Decide whether to inject systemPrompt (first turn only).
//   3. Append the new user message.
//   4. Hand the assembled message list to the LLM.
//   5. After the turn, append the assistant + tool messages back to
//      history.
//
// The original M1.3 implementation forgot step 3's PERSISTENCE side
// — getMessages built a fresh `[...prior, user]` array each turn but
// never wrote `user` back to history. onTurnComplete only appended
// the assistant's reply. Net effect: across N turns, history grew
// `[assistant_1, assistant_2, …]` with NO user messages — the LLM
// then saw the next user with no preceding question context.
//
// This module is the single source of truth so the bug can't recur
// in any of the three callers, and so future callers (M1.5 disk-
// backed history, M2.3 loadSession sharing) can swap their
// implementation in one place.

import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk';

import type { LLMMessage } from '../llm.js';
import type { DaemonSessionHistory } from './daemon-runtime.js';
import { acpPromptToLlmContent, flattenLlmContent } from '../acp/content-blocks.js';

/** Step 1-3 + persist: append the new user message to history,
 *  build the message list the LLM should see. Injects systemPrompt
 *  ONLY at the head of the very first turn (when history was
 *  empty before this user message landed). */
export function appendUserAndBuildMessages(
  history: DaemonSessionHistory,
  sessionId: string,
  userText: string,
  systemPrompt?: string,
): LLMMessage[] {
  const isFirstTurn = history.get(sessionId).length === 0;
  history.append(sessionId, [{ role: 'user', content: userText }]);
  const msgs: LLMMessage[] = [...history.get(sessionId)];
  if (systemPrompt && isFirstTurn) {
    msgs.unshift({ role: 'system', content: systemPrompt });
  }
  return msgs;
}

/** Step 2 of platform-evolution arc — sibling that preserves ACP's
 *  ContentBlock[] (image / resource_link / etc.) into the LLM message
 *  content. When `promptBlocks` is text-only, the persisted shape
 *  collapses back to `content: string` for wire compatibility with
 *  the pre-Step 2 jsonl + history.get() consumers. When attachments
 *  are present, persistence keeps `content: ContentBlock[]` —
 *  `LLMMessage.content: string | ContentBlock[]` (llm.ts:53-57)
 *  already permits both shapes. */
export function appendUserPromptBlocksAndBuildMessages(
  history: DaemonSessionHistory,
  sessionId: string,
  promptBlocks: readonly AcpContentBlock[],
  systemPrompt?: string,
): LLMMessage[] {
  const isFirstTurn = history.get(sessionId).length === 0;
  const llmBlocks = acpPromptToLlmContent(promptBlocks);
  const content = flattenLlmContent(llmBlocks);
  history.append(sessionId, [{ role: 'user', content }]);
  const msgs: LLMMessage[] = [...history.get(sessionId)];
  if (systemPrompt && isFirstTurn) {
    msgs.unshift({ role: 'system', content: systemPrompt });
  }
  return msgs;
}

/** Step 5: persist the assistant + tool messages the bridge / core-
 *  turn produced. Thin wrapper over `history.append` — exists so the
 *  call site reads as the symmetric companion to
 *  `appendUserAndBuildMessages`. */
export function appendAssistantMessages(
  history: DaemonSessionHistory,
  sessionId: string,
  newMessages: LLMMessage[],
): void {
  history.append(sessionId, newMessages);
}
