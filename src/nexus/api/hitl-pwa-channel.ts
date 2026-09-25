// NEXUS · PWA in-app HITL confirm channel (β-1a · 2026-05-08).
//
// Bridges `requestConfirmation()` to the PWA Showroom by publishing
// `hitl.banner.show` / `hitl.banner.cancel` events on the NEXUS
// event bus. The PWA subscribes via SSE (?topics=hitl.banner.) and
// renders an Approve/Reject banner; the user's tap POSTs back to
// `/v1/hitl/callback/:requestId`, the same endpoint Pushcut already
// resolves through. Single pending Map / single source of truth —
// the awaitCallback delegate hands off to `metaApi.hitlPending`.
//
// Why a separate module from `confirm.ts` createTelegram/Discord
// pattern: the producer side (request publishing) is server-driven
// here, not just adapter-around-existing-API. We keep the channel
// shape identical to confirm.ts so requestConfirmation() races them
// uniformly.
//
// Failure modes:
//   • bus.publish throws → channel returns null (other channels race).
//   • awaitCallback never resolves → outer requestConfirmation timeout
//     (default 5min in agent-cli wire) fires onTimeout fallback.
//   • cancel() also publishes — PWA hides banner mid-prompt when a
//     sibling channel won.
//
// Tests: `test/nexus-hitl-pwa-channel.test.ts`.

import type {
  ConfirmChannel,
  ConfirmRequest,
  HitlAnswer,
} from '../../hitl/confirm.js';
import type { QuestionChannel } from '../../hitl/question.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../../ask-user-question/types.js';
import type { NexusEventBus } from './event-bus.js';

export interface PwaConfirmDeps {
  /** The NEXUS event bus that SSE subscribers consume. The producer
   *  publishes `hitl.banner.show` / `hitl.banner.cancel` here; the
   *  bus's listeners include the http-server SSE writer. */
  bus: NexusEventBus;
  /** Awaits `POST /v1/hitl/callback/:requestId`. Implementations route
   *  through the runtime `hitlPending` callbacks store, mirroring the
   *  Pushcut channel's wire. Returning null/undefined → channel opted
   *  out (other channels race). */
  awaitCallback: (requestId: string) => Promise<HitlAnswer | null>;
  /** Optional override for requestId minting. Production lets the
   *  caller (`requestConfirmation`) pass requestId; this only fires
   *  when no requestId is supplied. Tests stub for determinism. */
  mintRequestId?: () => string;
}

export interface PwaQuestionDeps {
  bus: NexusEventBus;
  /** Awaits a structured answer on the same `/v1/hitl/callback/:requestId`
   *  path as binary confirm. Surfaces that cannot draw options still
   *  receive the enclosed `questions` payload (degrade, not declare). */
  awaitCallback: (requestId: string) => Promise<AskUserQuestionResult | null>;
  mintRequestId?: () => string;
}

function publishBannerCancel(bus: NexusEventBus, requestId: string): void {
  try {
    bus.publish({
      ts: Date.now(),
      kind: 'hitl.banner.cancel',
      detail: { requestId },
    });
  } catch { /* swallow */ }
}

export function createPwaConfirmChannel(deps: PwaConfirmDeps): ConfirmChannel {
  let activeRequestId: string | null = null;

  function publishShow(req: ConfirmRequest, requestId: string): void {
    try {
      deps.bus.publish({
        ts: Date.now(),
        kind: 'hitl.banner.show',
        detail: {
          requestId,
          prompt: req.prompt,
          ...(req.detail !== undefined ? { detail: req.detail } : {}),
          yesLabel: req.yesLabel ?? 'Yes',
          noLabel: req.noLabel ?? 'No',
        },
      });
    } catch {
      // Bus subscriber threw — bus.publish itself swallows, but a
      // wrapper failure (rare) shouldn't crash the channel. Returning
      // here means the request still awaits the callback; if no PWA
      // is connected the callback simply never arrives and the outer
      // requestConfirmation timeout takes over.
    }
  }

  return {
    name: 'pwa',
    async request(req: ConfirmRequest): Promise<HitlAnswer | null> {
      const requestId = req.requestId
        ?? deps.mintRequestId?.()
        ?? `hitl-pwa-${Date.now()}`;
      activeRequestId = requestId;
      publishShow(req, requestId);
      // The awaitCallback delegate is single-awaiter per the
      // hitlPending contract — when Pushcut (or another channel)
      // already holds the pending entry for this requestId, our
      // awaitCallback resolves to null immediately. We DON'T clear
      // activeRequestId on null so the surrounding race / sibling
      // resolution still triggers a banner-cancel via cancel(). On a
      // real answer (true/false) the http-server's resolveAnswer
      // arrives here and the banner has already been dismissed by
      // the user's click — clearing is purely housekeeping.
      const answer = await deps.awaitCallback(requestId);
      if (answer !== null && activeRequestId === requestId) {
        activeRequestId = null;
      }
      return answer;
    },
    cancel(): void {
      if (activeRequestId) {
        publishBannerCancel(deps.bus, activeRequestId);
        activeRequestId = null;
      }
    },
  };
}

/** SSE surface for structured AskUserQuestion. Publishes the full
 *  request (questions / options / multiSelect / includeOther) on the
 *  existing `hitl.banner.` topic so `/v1/events?topics=` still filters
 *  it. Binary confirm stays on `createPwaConfirmChannel` — this path
 *  never folds options into yes/no. */
export function createPwaQuestionChannel(deps: PwaQuestionDeps): QuestionChannel {
  const activeRequestIds = new Set<string>();

  function publishShow(req: AskUserQuestionRequest, requestId: string): void {
    try {
      deps.bus.publish({
        ts: Date.now(),
        kind: 'hitl.banner.show',
        detail: {
          requestId,
          prompt: req.questions[0]?.question ?? '',
          questions: req.questions,
          ...(req.delivery !== undefined ? { delivery: req.delivery } : {}),
        },
      });
    } catch {
      // Same fail-soft as confirm: the awaiter still waits; timeout
      // (or sibling cancel) is the recovery path.
    }
  }

  return {
    name: 'pwa',
    async ask(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null> {
      const requestId = deps.mintRequestId?.() ?? `hitl-pwa-q-${Date.now()}`;
      activeRequestIds.add(requestId);
      publishShow(req, requestId);
      const answer = await deps.awaitCallback(requestId);
      if (answer !== null) activeRequestIds.delete(requestId);
      return answer;
    },
    cancel(): void {
      for (const requestId of activeRequestIds) {
        publishBannerCancel(deps.bus, requestId);
      }
      activeRequestIds.clear();
    },
  };
}
