// UI-Core arc Phase U3 — `elanous/ui/*` envelope receiver.
//
// When a `sessionUpdate` notification arrives with an
// `agent_thought_chunk` whose text matches the envelope shape (see
// `src/acp/elanous-extensions.ts`), this module routes the payload to
// a consumer-supplied handler implementation. Otherwise the text is
// passed through as a plain agent thought chunk.
//
// This module is the reference dispatcher for ACP clients that want
// to render Elanous's extended UI surface (TUI, Web, iPhone). It has
// zero dependency on the TUI — the consumer plugs in a handler that
// calls into whatever renderer they own.

import {
  parseElanousUiEnvelope,
  type ElanousUiShowModalPayload,
  type ElanousUiShowToastPayload,
  type ElanousUiUpdateStatusPillPayload,
  type ElanousUiUsagePayload,
} from '../acp/elanous-extensions.js';

/** Consumer-supplied renderer. Missing methods are treated as
 *  capability-off — the dispatcher silently drops envelopes whose
 *  method the consumer didn't implement. This keeps ClientCapabilities
 *  honest: if the consumer doesn't set the flag in its `_meta`, the
 *  server wouldn't push, but if envelopes arrive anyway (e.g. from a
 *  future extension-unaware proxy) we still don't crash. */
export interface ElanousUiHandler {
  onShowModal?(payload: ElanousUiShowModalPayload): void | Promise<void>;
  onShowToast?(payload: ElanousUiShowToastPayload): void | Promise<void>;
  onUpdateStatusPill?(payload: ElanousUiUpdateStatusPillPayload): void | Promise<void>;
  onUsage?(payload: ElanousUiUsagePayload): void | Promise<void>;
}

/** Outcome of processing a single `agent_thought_chunk`. `ui` means
 *  the envelope was recognized and forwarded to the handler; `passthrough`
 *  means the text is a regular thought and should render as-is. */
export type ThoughtChunkOutcome =
  | { kind: 'ui'; method: 'showModal' | 'showToast' | 'updateStatusPill' | 'usage' }
  | { kind: 'passthrough'; text: string };

/** Inspect one thought-chunk text and either dispatch to the handler
 *  or return `passthrough` so the caller can render it as usual.
 *
 *  Callers typically wire this into their existing sessionUpdate
 *  stream handler: when the update is `agent_thought_chunk` with a
 *  text content, pass the text in; if the outcome is `ui`, skip the
 *  default thought rendering; otherwise render as before. */
export async function dispatchThoughtChunk(
  text: string,
  handler: ElanousUiHandler,
): Promise<ThoughtChunkOutcome> {
  const parsed = parseElanousUiEnvelope(text);
  if (!parsed) return { kind: 'passthrough', text };
  switch (parsed.method) {
    case 'showModal': {
      if (handler.onShowModal) {
        await handler.onShowModal(parsed.payload as unknown as ElanousUiShowModalPayload);
      }
      return { kind: 'ui', method: 'showModal' };
    }
    case 'showToast': {
      if (handler.onShowToast) {
        await handler.onShowToast(parsed.payload as unknown as ElanousUiShowToastPayload);
      }
      return { kind: 'ui', method: 'showToast' };
    }
    case 'updateStatusPill': {
      if (handler.onUpdateStatusPill) {
        await handler.onUpdateStatusPill(parsed.payload as unknown as ElanousUiUpdateStatusPillPayload);
      }
      return { kind: 'ui', method: 'updateStatusPill' };
    }
    case 'usage': {
      if (handler.onUsage) {
        await handler.onUsage(parsed.payload as unknown as ElanousUiUsagePayload);
      }
      return { kind: 'ui', method: 'usage' };
    }
  }
}

/** Helper — extract the text field from a minimal `agent_thought_chunk`
 *  sessionUpdate shape. Returns null for other update kinds or when
 *  the content isn't plain text. */
export function extractAgentThoughtText(update: unknown): string | null {
  if (!update || typeof update !== 'object') return null;
  const u = update as {
    sessionUpdate?: string;
    content?: { type?: string; text?: string };
  };
  if (u.sessionUpdate !== 'agent_thought_chunk') return null;
  if (!u.content || u.content.type !== 'text' || typeof u.content.text !== 'string') return null;
  return u.content.text;
}
