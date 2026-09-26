// elanous/ask/* ACP extension — cross-surface AskUserQuestion wire.
//
// **2026-05-13 정정**: SDK v0.14.1 의 양방향 `extMethod` / `extNotification`
// 활용. 초안 (envelope-in-text 패턴 · elanous/ui/*, elanous/feedback/* sibling) 폐기.
// 근거: chunk boundary safety + LLM history 0-leak + SDK correlation 자동 +
// Codex `request_user_input` wire 정합.
// 자세한 결정 record: docs/research/RESEARCH-ask-user-question-cross-surface-
// 2026-05-13.md §3 Axis 1 + §5 D1.
//
// Wire:
//   server → client request  : connection.extMethod('elanous/ask/request', payload)
//                              → AskUserQuestionResult (Promise)
//   server → client cancel   : connection.extNotification('elanous/ask/cancel', payload)
//                              → fire-and-forget
//
// Capability negotiation:
//   client 가 _meta.elanous.ask = { askUserQuestion: true } 선언 시 server 가 push.
//   미선언 peer 에는 dispatcher 가 fallthrough (TUI deps → resolver → 구조화 error).
//
// 기존 3 namespace (elanous/ui/* · elanous/term/* · elanous/feedback/*) 의 envelope-
// in-text 패턴은 production 검증 + ROI 낮음으로 본 사이클 변경 0. 후속 backlog
// 항목 ("ext-migration: 3 namespace extMethod 통일") 으로 분리.

import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../ask-user-question/types.js';

// ── method names ──────────────────────────────────────────────────

/** Server → client RPC. Payload = ElanousAskRequestPayload · result =
 *  AskUserQuestionResult. SDK 가 JSON-RPC id 매칭 자동 + Promise 자동 resolve. */
export const ELANOUS_ASK_REQUEST_METHOD = 'elanous/ask/request' as const;

/** Server → client notification. Payload = ElanousAskCancelPayload.
 *  Server 가 turn abort 또는 session/cancel 받았을 때 push. 클라이언트는
 *  open sheet 가 매칭되면 dismiss · 매칭 없으면 무해히 drop. 서버측 pending
 *  Promise 는 별 path 로 reject (SDK 는 timeout/cancel 없으므로). */
export const ELANOUS_ASK_CANCEL_METHOD = 'elanous/ask/cancel' as const;

export type ElanousAskMethod = typeof ELANOUS_ASK_REQUEST_METHOD | typeof ELANOUS_ASK_CANCEL_METHOD;

// ── payload types ─────────────────────────────────────────────────

/** Server → client request payload. `id` 는 server-side correlation /
 *  telemetry 용 (debug.log · audit) — SDK 의 JSON-RPC id 와 다른 별 식별자.
 *  pending Promise 매칭에는 사용하지 않음 (SDK 가 자동). */
export interface ElanousAskRequestPayload {
  id: string;
  request: AskUserQuestionRequest;
}

/** Server → client cancel notification payload. 클라이언트는 open sheet 의
 *  내부 id (server push 시 받은 동일 id) 와 매칭 → dismiss. */
export interface ElanousAskCancelPayload {
  id: string;
  /** Optional human-readable reason. Logged on receiver side; not
   *  required for the cancel path. */
  reason?: string;
}

// ── inbound params validators ─────────────────────────────────────
//
// extMethod handler 가 받는 params 는 unknown — JSON.parse 결과. 본 validator
// 들은 wire 에서 들어온 raw object 를 typed payload 로 좁힘 (zod 의존 회피 ·
// 본 파일 lightweight 유지). 실패 시 null 반환 — caller 가 RequestError.invalidParams
// 던지도록.

export function parseElanousAskRequestPayload(raw: unknown): ElanousAskRequestPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { id?: unknown; request?: unknown };
  if (typeof o.id !== 'string' || !o.id) return null;
  if (!o.request || typeof o.request !== 'object') return null;
  const req = o.request as { questions?: unknown };
  if (!Array.isArray(req.questions) || req.questions.length === 0) return null;
  // 더 깊은 검증 (per-question header / options) 은 dispatcher 의
  // parseQuestionRequest 가 이미 수행 — wire 에서는 shape sniff 만.
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

// ── result validator (server side · 응답 받을 때) ─────────────────

/** server 가 client.extMethod 응답으로 받은 raw result 를 AskUserQuestionResult
 *  로 좁힘. 응답이 malformed 면 cancelled=true 로 degrade — 무한 대기보다
 *  안전한 default. (예: 클라이언트가 connection close 직전에 garbage 보낸 경우) */
export function coerceAskResult(raw: unknown): AskUserQuestionResult {
  if (!raw || typeof raw !== 'object') {
    return { answers: {}, cancelled: true };
  }
  const o = raw as { answers?: unknown; otherText?: unknown; cancelled?: unknown; answeredBy?: unknown };
  const answers: Record<string, string | string[]> = {};
  if (o.answers && typeof o.answers === 'object') {
    for (const [k, v] of Object.entries(o.answers)) {
      if (typeof v === 'string') answers[k] = v;
      else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        answers[k] = v as string[];
      }
    }
  }
  const out: AskUserQuestionResult = { answers };
  if (o.otherText && typeof o.otherText === 'object') {
    const ot: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.otherText)) {
      if (typeof v === 'string') ot[k] = v;
    }
    if (Object.keys(ot).length > 0) out.otherText = ot;
  }
  if (o.cancelled === true) out.cancelled = true;
  if (o.answeredBy === 'human' || o.answeredBy === 'agent') out.answeredBy = o.answeredBy;
  return out;
}

// ── capabilities ─────────────────────────────────────────────────

export interface ElanousAskClientCapabilities {
  /** True when the peer can render a structured AskUserQuestion sheet
   *  natively. Daemon-side resolver gates emission on this — peers
   *  without the capability fall through to TUI deps → resolver →
   *  구조화 error. */
  askUserQuestion: boolean;
}

export const ELANOUS_ASK_DISABLED: ElanousAskClientCapabilities = {
  askUserQuestion: false,
};

export const ELANOUS_ASK_FULL: ElanousAskClientCapabilities = {
  askUserQuestion: true,
};

/** Parse the `_meta.elanous.ask` capability blob from ClientCapabilities.
 *  Missing / malformed → all-false (conservative, matches sibling
 *  `parseElanousUiCapabilities`). */
export function parseElanousAskCapabilities(
  meta: unknown,
): ElanousAskClientCapabilities {
  if (!meta || typeof meta !== 'object') return { ...ELANOUS_ASK_DISABLED };
  const m = meta as { elanous?: { ask?: Record<string, unknown> } };
  const ask = m.elanous?.ask;
  if (!ask || typeof ask !== 'object') return { ...ELANOUS_ASK_DISABLED };
  return {
    askUserQuestion: ask.askUserQuestion === true,
  };
}

export function emitElanousAskCapabilitiesMeta(
  caps: ElanousAskClientCapabilities,
): { elanous: { ask: ElanousAskClientCapabilities } } {
  return { elanous: { ask: { ...caps } } };
}
