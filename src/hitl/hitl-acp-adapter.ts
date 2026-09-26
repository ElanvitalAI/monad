// AXON P4 — bridge HITL channels into ACP approver signatures.
//
// `AcpAgent.permissionApprover(req) → Promise<boolean>` and
// `AcpAgent.questionApprover(req) → Promise<AcpQuestionResponse>` are
// the two callbacks an ACP client exposes to the subprocess when it
// wants user approval. Before AXON, dashboard wired a local modal
// directly into those slots. This adapter lets us route them through
// the same multi-channel race that `requestConfirmation()` already
// uses — Telegram wins if you're on your phone, Discord wins if
// you're on your laptop, terminal modal wins if you're staring at
// elanous, whichever answers first.
//
// 2026-05-13 (M5 of AskUserQuestion cross-surface) — Phase β: the
// yes/no question collapse (pick first option · cancel on reject) is
// now opt-in. Callers that pass `questionChannels` get the full multi-
// option fan-out via `requestQuestion()` — Discord buttons / Telegram
// inline keyboard / Pushcut deep-link. Empty `questionChannels` keeps
// the legacy yes/no collapse so production deployments without the
// channel impls land yet don't regress.

import type {
  AcpPermissionApprovalRequest,
  AcpPermissionApprover,
  AcpQuestionApprover,
  AcpQuestionRequest,
  AcpQuestionResponse,
} from '../acp/client.js';
import type { BackgroundManager } from '../acp/background-manager.js';
import { requestConfirmation, type ConfirmChannel } from './confirm.js';
import { requestQuestion, type QuestionChannel } from './question.js';
import type { HitlDelivery } from './types.js';
import type { AskUserQuestionRequest } from '../ask-user-question/types.js';

export interface HitlAdapterOpts {
  /** Channels to race. Defaults to the process-wide registered set. */
  channels?: ConfirmChannel[];
  /** M5 of PLAN-ask-user-question-cross-surface-2026-05-13 — multi-
   *  option question channels. When present, structured AskUserQuestion
   *  prompts fan out via `requestQuestion()` (Discord buttons / Telegram
   *  inline keyboard / Pushcut deep-link) instead of the legacy yes/no
   *  collapse. Empty / absent keeps the yes/no compatibility shim so
   *  production deployments without channel impls don't regress. */
  questionChannels?: QuestionChannel[];
  /** Delivery filter — `'all'` (default) races every channel, other
   *  values scope to a single channel name. */
  delivery?: HitlDelivery;
  /** Per-request timeout in ms. Falls through to confirm.ts default. */
  timeoutMs?: number;
  /** Sync fallback answer when every channel fails / times out.
   *  Default `false` (deny), matching requestConfirmation's fail-
   *  closed policy. */
  onTimeout?: () => boolean;
  /** Follow-up #9 — when set, the approver fires BG approval signals
   *  against this manager for any request whose `sessionId` maps to a
   *  BG record. Co-exists with the peer's wire `tool_call_update.
   *  status` path — both call `transition(...)`, which is idempotent
   *  on target state so redundant fires are harmless. Backends that
   *  don't emit the status field (observed in codex-acp / gemini-cli
   *  partially) finally get correct `waiting_for_confirmation` UX
   *  through this arm alone. */
  backgroundManager?: BackgroundManager;
}

/** Wrap an `AcpAgent.permissionApprover` slot around HITL channels. */
export function createAcpPermissionApproverFromHitl(
  opts: HitlAdapterOpts = {},
): AcpPermissionApprover {
  return async (req: AcpPermissionApprovalRequest) => {
    // Follow-up #9 — signal BG waiting BEFORE the await so the sidebar
    // / push-notifier sees the transition while the human decides.
    // try/finally guarantees the resumed signal fires even on throw.
    // `req.sessionId` here is the RAW backend session id · BG manager
    // looks up the record via (backendId, backendSessionId) and no-op
    // when the session isn't a BG one (foreground DRM sessions unaffected).
    opts.backgroundManager?.signalApprovalWaiting(req.backendId, req.sessionId);
    try {
      const result = await requestConfirmation({
        prompt: `${req.backendId} wants to ${req.title}`,
        detail: renderPermissionDetail(req),
        yesLabel: 'Approve',
        noLabel: 'Reject',
        ...(opts.channels ? { channels: opts.channels } : {}),
        ...(opts.delivery ? { delivery: opts.delivery } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.onTimeout ? { onTimeout: opts.onTimeout } : {}),
        requestId: `acp-perm-${req.sessionId}-${Date.now().toString(36)}`,
      });
      return result.answer === true;
    } finally {
      opts.backgroundManager?.signalApprovalResumed(req.backendId, req.sessionId);
    }
  };
}

/** Wrap an `AcpAgent.questionApprover` slot. Two paths:
 *
 *  1. `opts.questionChannels` set (M5 · 2026-05-13) — fan the request
 *     out as a real AskUserQuestionRequest via `requestQuestion()`.
 *     Channels render N buttons + cancel + Other; whichever device
 *     answers first wins. This is the "no collapse" path that finally
 *     surfaces multi-option to Discord/Telegram users.
 *  2. Empty / absent `questionChannels` — legacy yes/no collapse via
 *     `requestConfirmation()` (pick first option on Yes · cancel on
 *     No). Same behaviour as before #2611, preserved so deployments
 *     without channel impls land yet don't regress. */
export function createAcpQuestionApproverFromHitl(
  opts: HitlAdapterOpts = {},
): AcpQuestionApprover {
  return async (req: AcpQuestionRequest): Promise<AcpQuestionResponse> => {
    opts.backgroundManager?.signalApprovalWaiting(req.backendId, req.sessionId);
    try {
      // Path 1 — proper multi-option fan-out via requestQuestion.
      if (opts.questionChannels && opts.questionChannels.length > 0) {
        return await dispatchViaQuestionChannels(req, opts);
      }
      // Path 2 — legacy yes/no collapse compat shim.
      return await dispatchViaYesNoCollapse(req, opts);
    } finally {
      opts.backgroundManager?.signalApprovalResumed(req.backendId, req.sessionId);
    }
  };
}

/** M5 path — proper multi-option fan-out via `requestQuestion()`. */
async function dispatchViaQuestionChannels(
  req: AcpQuestionRequest,
  opts: HitlAdapterOpts,
): Promise<AcpQuestionResponse> {
  // AcpQuestionRequest 의 questions 가 이미 AskUserQuestion 스키마와
  // 호환되는 shape. multiSelect 와 includeOther 는 ACP 가 surface 안
  // 하므로 default 채움 (includeOther true · multiSelect false 가 모달
  // 측 기본).
  const askReq: AskUserQuestionRequest = {
    questions: req.questions.map((q) => ({
      id: q.id,
      header: q.header,
      question: q.question,
      options: q.options.map((o) => ({
        label: o.label,
        description: o.description,
        ...(o.preview !== undefined ? { preview: o.preview } : {}),
      })),
      multiSelect: q.multiSelect === true,
      includeOther: q.includeOther !== false,
    })),
  };
  const raceOpts: Parameters<typeof requestQuestion>[0] = {
    request: askReq,
    channels: opts.questionChannels!,
    requestId: `acp-q-${req.sessionId}-${Date.now().toString(36)}`,
  };
  if (opts.timeoutMs !== undefined) raceOpts.timeoutMs = opts.timeoutMs;
  const { result } = await requestQuestion(raceOpts);
  // AcpQuestionResponse 는 answers 값에 string | string[] 모두 허용 →
  // requestQuestion 의 결과를 직접 매핑.
  const out: AcpQuestionResponse = { answers: result.answers };
  if (result.otherText !== undefined) out.otherText = result.otherText;
  if (result.cancelled === true) out.cancelled = true;
  return out;
}

/** Legacy yes/no collapse path — preserved for deployments without
 *  proper QuestionChannel impls. Same behaviour as pre-M5. */
async function dispatchViaYesNoCollapse(
  req: AcpQuestionRequest,
  opts: HitlAdapterOpts,
): Promise<AcpQuestionResponse> {
  const answers: Record<string, string> = {};
  for (const q of req.questions) {
    const firstOption = q.options[0];
    if (!firstOption) {
      return { answers: {}, cancelled: true };
    }
    const result = await requestConfirmation({
      prompt: q.question,
      detail: [
        `[${req.backendId}] ${q.header}`,
        `Pick first option ("${firstOption.label}"${firstOption.description ? ` — ${firstOption.description}` : ''})?`,
        'Approve → first option. Reject → cancel the entire question set.',
      ].join('\n'),
      yesLabel: firstOption.label,
      noLabel: 'Cancel',
      ...(opts.channels ? { channels: opts.channels } : {}),
      ...(opts.delivery ? { delivery: opts.delivery } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.onTimeout ? { onTimeout: opts.onTimeout } : {}),
      requestId: `acp-q-${q.id}-${Date.now().toString(36)}`,
    });
    if (result.answer !== true) return { answers: {}, cancelled: true };
    answers[q.id] = firstOption.label;
  }
  return { answers };
}

function renderPermissionDetail(req: AcpPermissionApprovalRequest): string {
  const parts: string[] = [];
  parts.push(`session: ${req.sessionId}`);
  if (req.kind) parts.push(`kind: ${req.kind}`);
  if (req.options && req.options.length > 0) {
    parts.push(`options: ${req.options.map(o => o.kind).join(', ')}`);
  }
  return parts.join('\n');
}
