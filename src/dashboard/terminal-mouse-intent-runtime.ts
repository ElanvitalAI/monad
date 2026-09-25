import { isCaptureSessionMouseEventType, isDiscreteClickMouseEventType } from '../display/types.js';
import type { DisplayEvent } from '../display/events.js';
import {
  intentFromMouseEvent,
  interpretTerminalSurfaceIntent,
  type SerializableSurfaceIntent,
} from './terminal-surface-intent.js';

type TerminalMouseIntentEvent = Extract<DisplayEvent, { type: 'terminal:mouse-intent' }>;

export interface TerminalMouseIntentRuntimeDeps {
  isDebugEnabled: () => boolean;
  isKeyTraceEnabled: () => boolean;
  logDebug: (category: string, event: string, data?: unknown) => void;
  /** PR-2 — ring buffer cap. Defaults to 8 (matching dashboard's
   *  prior local buffer size). */
  ringSize?: number;
}

/**
 * PR-2 of multi-platform substrate ROADMAP — consumer in the
 * surface-intent canonical chain.
 *
 * Per G6 (capability is gate, not intent replacement): use the
 * `if (!intent.capability.canX) return reject` pattern. Do not
 * subsume `intent.kind` matching into capability booleans.
 *
 * Per G7 (no stale): consumers receive the intent's `exposure` and
 * `capability` snapshot at emit time. They are NOT live references —
 * if a consumer needs the latest posture, look it up via the
 * appropriate registry rather than caching this snapshot.
 *
 * Serializable-first (G5): `intent` is JSON-clean. A consumer that
 * forwards intents over ACP / WebSocket can serialize directly.
 */
export interface TerminalSurfaceIntentConsumer {
  /** Stable id for debug logs and unsubscribe identity. */
  readonly id: string;
  /** Lower fires earlier; first `handled: true` wins. Optional;
   *  defaults to 100. Use distinct values to enforce ordering. */
  readonly priority?: number;
  handle(intent: SerializableSurfaceIntent): TerminalSurfaceIntentResult;
}

export interface TerminalSurfaceIntentResult {
  /** True if this consumer claims the intent — chain stops here.
   *  False means pass to next consumer. */
  handled: boolean;
  /** Optional reason — flows into debug log; useful for capability
   *  gates that reject. */
  reason?: string;
}

export interface TerminalMouseIntentRuntime {
  shouldMirrorToDebug(event: TerminalMouseIntentEvent): boolean;
  onDisplayEvent(event: DisplayEvent): void;
  /**
   * PR-2 — register a consumer in the canonical chain.
   *
   * Per G2 (this arc only the dashboard wires consumers): external
   * hosts (ACP/Discord/PWA) attach via the facade in PR-3, not
   * directly. This API is internal to the TUI host today.
   */
  registerConsumer(consumer: TerminalSurfaceIntentConsumer): () => void;
  /** Snapshot of currently registered consumers (insertion order
   *  with priority sorted ascending). */
  listConsumers(): readonly TerminalSurfaceIntentConsumer[];
  /**
   * PR-2 — ring buffer of recent intents that flowed through the chain
   * (chunk events + motion events excluded). Replaces the dashboard-
   * local `recentTerminalMouseIntents` array.
   */
  recentIntents(): readonly SerializableSurfaceIntent[];
}

const DEFAULT_PRIORITY = 100;
const DEFAULT_RING_SIZE = 8;

export function createTerminalMouseIntentRuntime(
  deps: TerminalMouseIntentRuntimeDeps,
): TerminalMouseIntentRuntime {
  const ringSize = deps.ringSize ?? DEFAULT_RING_SIZE;
  const ring: SerializableSurfaceIntent[] = [];
  const consumers: TerminalSurfaceIntentConsumer[] = [];

  const shouldMirrorToDebug = (event: TerminalMouseIntentEvent): boolean => {
    if (!deps.isDebugEnabled()) return false;
    if (event.mouseType === 'motion') return deps.isKeyTraceEnabled();
    return isDiscreteClickMouseEventType(event.mouseType)
      || isCaptureSessionMouseEventType(event.mouseType);
  };

  const registerConsumer = (consumer: TerminalSurfaceIntentConsumer): () => void => {
    consumers.push(consumer);
    consumers.sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
    if (deps.isDebugEnabled()) {
      deps.logDebug('terminal.intent.consumer-register', consumer.id, {
        priority: consumer.priority ?? DEFAULT_PRIORITY,
        total: consumers.length,
      });
    }
    return () => {
      const idx = consumers.indexOf(consumer);
      if (idx === -1) return;
      consumers.splice(idx, 1);
      if (deps.isDebugEnabled()) {
        deps.logDebug('terminal.intent.consumer-unregister', consumer.id, {
          total: consumers.length,
        });
      }
    };
  };

  const dispatchToConsumers = (intent: SerializableSurfaceIntent): void => {
    for (const consumer of consumers) {
      let result: TerminalSurfaceIntentResult;
      try {
        result = consumer.handle(intent);
      } catch (err) {
        // Isolate per-consumer throws — chain continues.
        if (deps.isDebugEnabled()) {
          deps.logDebug('terminal.intent.consumer-throw', consumer.id, {
            kind: intent.kind,
            error: String(err),
          });
        }
        continue;
      }
      if (result.handled) {
        if (deps.isDebugEnabled()) {
          deps.logDebug('terminal.intent.consumed', consumer.id, {
            kind: intent.kind,
            surfaceId: intent.surfaceId,
            row: intent.row,
            col: intent.col,
            ...(result.reason ? { reason: result.reason } : {}),
          });
        }
        return;
      }
      if (deps.isDebugEnabled() && result.reason) {
        deps.logDebug('terminal.intent.gate-blocked', consumer.id, {
          kind: intent.kind,
          reason: result.reason,
        });
      }
    }
    if (deps.isDebugEnabled()) {
      deps.logDebug('terminal.intent.unhandled', intent.kind, {
        surfaceId: intent.surfaceId,
        consumers: consumers.length,
      });
    }
  };

  return {
    shouldMirrorToDebug,
    onDisplayEvent(event) {
      if (event.type !== 'terminal:mouse-intent') return;
      // Debug mirror keeps PR #1333 behavior — fires for motion too
      // when key-trace is on, so the existing diagnostic lane is
      // preserved.
      if (shouldMirrorToDebug(event)) {
        deps.logDebug('terminal.mouse-intent', event.mouseType, {
          surfaceId: event.surfaceId,
          paneKind: event.paneKind,
          hostInterpretation: interpretTerminalSurfaceIntent(event),
          row: event.row,
          col: event.col,
          transport: event.transport,
          userExposure: event.exposure.userExposure,
          keyboardParticipation: event.interactionPolicy.keyboardParticipation,
          mouseTransport: event.interactionPolicy.mouseTransport,
        });
      }
      // PR-2 canonical chain — motion / hover (G3) excluded by
      // intentFromMouseEvent returning null. Ring buffer also excludes
      // motion to match downstream consumer semantics.
      const intent = intentFromMouseEvent(event);
      if (!intent) return;
      ring.push(intent);
      while (ring.length > ringSize) ring.shift();
      dispatchToConsumers(intent);
    },
    registerConsumer,
    listConsumers() {
      return consumers.slice();
    },
    recentIntents() {
      return ring.slice();
    },
  };
}
