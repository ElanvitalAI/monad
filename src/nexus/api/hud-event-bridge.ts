// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M2 — HudStore ↔
// NexusEventBus bridge.
//
// Mirrors agent-status-event-bridge.ts (and workflow-event-bridge.ts):
// the store is the canonical truth; every set/clear publishes one
// `hud.segment` NexusEvent so `/v1/events?topics=hud.segment` SSE
// subscribers (PWA `<ChatHud>` via subscribeHudSegmentEvents — added
// in M4) see live HUD transitions.
//
// Detail carries the FeedbackEnvelope-style shape so the PWA can
// synthesize a `kind: 'hud.segment'` envelope from each event without
// schema drift. Phase 'update' for upsert · phase 'end' for clear.
//
// PLAN-ios-rich-dev-feedback-hydrate M4 (2026-05-13) — additionally
// fans out to ACP peers (iOS native) via the all-sessions feedback
// broadcaster. PWA SSE wire unchanged; ACP is the second carrier.

import type { HudStore } from '../state/hud-store.js';
import type { NexusEventBus } from './event-bus.js';
import { getActiveAcpAllSessionsFeedbackBroadcaster } from '../../acp/server.js';

/** `extends Record<string, unknown>` so the type fits NexusEvent.detail
 *  without an unsafe cast. Closed-shape fields above the index signature
 *  are still type-checked against callers. */
export interface HudSegmentEventDetail extends Record<string, unknown> {
  /** `phase: 'update'` → upsert · `phase: 'end'` → clear. */
  phase: 'update' | 'end';
  key: string;
  /** Present only on phase='update'. The synthesized FeedbackEnvelope's
   *  payload mirrors this object 1:1 (apart from the phase routing). */
  value?: string;
  priority?: number;
  tone?: 'normal' | 'warn' | 'danger' | 'success' | 'info' | 'muted';
  glyph?: string;
}

export function wireHudSegmentEvents(
  bus: NexusEventBus,
  store: HudStore,
): () => void {
  let seqCounter = 0;
  return store.subscribe((event) => {
    const ts = Date.now();
    if (event.kind === 'set') {
      const detail: HudSegmentEventDetail = {
        phase: 'update',
        key: event.payload.key,
        value: event.payload.value,
        ...(event.payload.priority !== undefined ? { priority: event.payload.priority } : {}),
        ...(event.payload.tone !== undefined ? { tone: event.payload.tone } : {}),
        ...(event.payload.glyph !== undefined ? { glyph: event.payload.glyph } : {}),
      };
      bus.publish({ ts, kind: 'hud.segment', detail });
      // PLAN-ios-rich-dev-feedback-hydrate M4 — ACP all-sessions fanout.
      // sessionId 는 broadcaster 가 per-session 으로 stamp.
      const broadcast = getActiveAcpAllSessionsFeedbackBroadcaster();
      if (broadcast) {
        seqCounter += 1;
        void broadcast({
          envelopeVersion: 1,
          blockId: `hud:${event.payload.key}`,
          phase: 'update',
          emittedAt: ts,
          seq: seqCounter,
          kind: 'hud.segment',
          payload: {
            key: event.payload.key,
            value: event.payload.value,
            ...(event.payload.priority !== undefined ? { priority: event.payload.priority } : {}),
            ...(event.payload.tone !== undefined ? { tone: event.payload.tone } : {}),
            ...(event.payload.glyph !== undefined ? { glyph: event.payload.glyph } : {}),
          },
          asciiFallback: [`HUD[${event.payload.key}] = ${event.payload.value}`],
        });
      }
    } else {
      const detail: HudSegmentEventDetail = { phase: 'end', key: event.key };
      bus.publish({ ts, kind: 'hud.segment', detail });
      const broadcast = getActiveAcpAllSessionsFeedbackBroadcaster();
      if (broadcast) {
        seqCounter += 1;
        void broadcast({
          envelopeVersion: 1,
          blockId: `hud:${event.key}`,
          phase: 'end',
          emittedAt: ts,
          seq: seqCounter,
          kind: 'hud.segment',
          payload: { key: event.key, value: '' },
          asciiFallback: [`HUD[${event.key}] cleared`],
        });
      }
    }
  });
}
