// elanous/ask/* TypeScript schema mirror — PWA side.
// M4 of PLAN-ask-user-question-cross-surface-2026-05-13.
//
// Canonical schema lives at monad-agent's `src/acp/ask-extensions.ts`
// (server) + `src/ask-user-question/types.ts` (LLM-facing). PWA imports
// nothing from `src/` because Next.js compiles outside that path; this
// file is a manual mirror that must stay in lock-step with method names
// + payload shapes. Shape-drift = wire failure — guarded by `coerce*`
// helpers that reject malformed payloads at the boundary instead of
// propagating undefined into the React tree.

/** Method names — must match `src/acp/ask-extensions.ts` exactly. */
export const ELANOUS_ASK_REQUEST_METHOD = 'elanous/ask/request' as const;
export const ELANOUS_ASK_CANCEL_METHOD = 'elanous/ask/cancel' as const;

/** One option within a question. */
export interface AskQuestionOption {
  label: string;
  description: string;
  /** Optional preview — if present, rendered under the description. */
  preview?: string;
}

export interface AskQuestion {
  id: string;
  header: string;
  question: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
  includeOther?: boolean;
}

export interface AskUserQuestionRequest {
  questions: AskQuestion[];
  /** AXON F4 optional routing hint — round-tripped only. */
  delivery?: string;
}

/** Server → client extMethod params payload. */
export interface ElanousAskRequestPayload {
  id: string;
  request: AskUserQuestionRequest;
}

/** Server → client extNotification cancel payload. */
export interface ElanousAskCancelPayload {
  id: string;
  reason?: string;
}

/** Per-question answer value — string for single-select, string[] for
 *  multi-select. */
export type AnswerValue = string | string[];

/** Client → server response payload (returned as the JSON-RPC `result`
 *  of `elanous/ask/request`). */
export interface AskUserQuestionResult {
  answers: Record<string, AnswerValue>;
  otherText?: Record<string, string>;
  cancelled?: boolean;
}

/** Sentinel label used when the user picks the "Other" row. Matches
 *  server-side `OTHER_LABEL` so the dispatcher's parsers don't need a
 *  second special case. */
export const ASK_OTHER_LABEL = 'Other';

// ── inbound payload validators ────────────────────────────────────

export function parseElanousAskRequestPayload(raw: unknown): ElanousAskRequestPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { id?: unknown; request?: unknown };
  if (typeof o.id !== 'string' || !o.id) return null;
  if (!o.request || typeof o.request !== 'object') return null;
  const req = o.request as { questions?: unknown };
  if (!Array.isArray(req.questions) || req.questions.length === 0) return null;
  // Trust the shape past the questions[] gate — server-side dispatcher
  // has already validated the inner items via `parseQuestionRequest`.
  return { id: o.id, request: o.request as AskUserQuestionRequest };
}

export function parseElanousAskCancelPayload(raw: unknown): ElanousAskCancelPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { id?: unknown; reason?: unknown };
  if (typeof o.id !== 'string' || !o.id) return null;
  return {
    id: o.id,
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
  };
}
