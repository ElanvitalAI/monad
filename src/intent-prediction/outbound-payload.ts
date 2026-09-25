// F1 (2026-05-12) — IntentRanking → OutboundEvent payload builder.
//
// Pure transformation that feeds the W7 OutboundRouter substrate.
// Caller is any future consumer (intent-prediction tick subscriber or
// the upcoming PR #4 router exposure) — pass an IntentRanking, get an
// OutboundEvent the router can dispatch to any channel (ios-push ·
// live-activity · watch-card · etc.).
//
// Cross-ref:
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7.4 — APNs payload spec.
//     The channel-specific ApnsPayload conversion lives in
//     src/showroom/outbound/channels/ios-push.ts (`buildApnsPayload`)
//     and consumes the OutboundEvent.payload field directly.
//   src/showroom/outbound/types.ts — OutboundEvent contract.
//   src/intent-prediction/types.ts — IntentRanking source.
//
// Determinism guarantee: given the same IntentRanking + opts, this
// function returns byte-identical OutboundEvent. No `Date.now()` calls
// unless the caller passes `opts.now`. Test seam.

import type { IntentRanking } from './types.js';
import type { OutboundEvent, OutboundUrgency } from '../showroom/outbound/types.js';

export interface BuildOutboundEventOpts {
  /** Defaults to 'normal'. Caller decides per surface — Live Activity
   *  on an actively-watched lock screen wants 'high' (Apple's "Time
   *  Sensitive" tier bypasses Focus mode); ambient prediction wants
   *  'low' so it doesn't break the user's flow. */
  urgency?: OutboundUrgency;
  /** Wall-clock override — defaults to `ranking.generatedAt` so the
   *  ranking + the outbound event share a single timestamp. */
  now?: () => number;
  /** Deep-link target the OS opens on body-tap. Action-button clicks
   *  route through the channel's own action handler (see SW push
   *  handler for the PWA path · App Intents for native iOS). */
  link?: string;
  /** Override the title — defaults to `monad · <top label>`. */
  title?: string;
  /** Override source — defaults to 'thinker' since intent prediction
   *  is a "suggested next action" surface (Thinker territory in the
   *  Background Reasoning ROADMAP). */
  source?: OutboundEvent['source'];
}

/** Build an OutboundEvent from an IntentRanking. The top-confidence
 *  candidate drives the headline; the runner-up appears as the body
 *  so the user has a single tap for "yes/the suggested" + glance at
 *  the alternative without expanding. The full 6-candidate ranking
 *  rides in `payload.candidates` so channels that render an action
 *  array (APNs · WatchKit · Dynamic Island expanded view) can use
 *  them. */
export function buildOutboundEventFromRanking(
  ranking: IntentRanking,
  opts: BuildOutboundEventOpts = {},
): OutboundEvent {
  if (!ranking.candidates.length) {
    // The ranker contract guarantees 6 entries — an empty list means
    // the caller built the IntentRanking by hand and forgot. We still
    // produce a valid event (channels handle the no-action case).
    return {
      id: `intent-${ranking.sessionId}-${ranking.version}`,
      source: opts.source ?? 'thinker',
      urgency: opts.urgency ?? 'normal',
      title: opts.title ?? 'monad',
      ...(opts.link ? { link: opts.link } : {}),
      payload: {
        kind: 'intent-prediction',
        sessionId: ranking.sessionId,
        version: ranking.version,
        candidates: [],
      },
      ts: opts.now ? opts.now() : ranking.generatedAt,
    };
  }
  // Sort a copy by confidence desc — IntentRanking.candidates is in
  // canonical label order, not confidence order.
  const sorted = [...ranking.candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0]!;
  const next = sorted[1];
  const title = opts.title ?? `monad · ${top.label}`;
  const body = next ? `또는 ${next.label}?` : undefined;
  return {
    id: `intent-${ranking.sessionId}-${ranking.version}`,
    source: opts.source ?? 'thinker',
    urgency: opts.urgency ?? 'normal',
    title,
    ...(body ? { body } : {}),
    ...(opts.link ? { link: opts.link } : {}),
    payload: {
      kind: 'intent-prediction',
      sessionId: ranking.sessionId,
      version: ranking.version,
      candidates: sorted.map((c) => ({
        label: c.label,
        confidence: c.confidence,
      })),
    },
    ts: opts.now ? opts.now() : ranking.generatedAt,
  };
}
