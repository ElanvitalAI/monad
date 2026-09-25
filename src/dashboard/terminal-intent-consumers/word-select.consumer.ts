// PR-2 placeholder consumer · word-select intent (double-click).
//
// G4 invariant: double-click is host-synthesized intent. SGR 1006 has
// no representation for it; `transport: 'host-only'` ensures the PTY
// child never sees a ghost event. The consumer chain is the canonical
// landing zone for this intent.
//
// Future product behavior: extract the word at (row, col) from the
// surface buffer and write to clipboard / attach as candidate
// identifier in the next LLM turn. This commit lands the gate +
// dispatch shape; actual buffer extraction stays for a separate arc.

import type {
  TerminalSurfaceIntentConsumer,
  TerminalSurfaceIntentResult,
} from '../terminal-mouse-intent-runtime.js';
import type { SerializableSurfaceIntent } from '../terminal-surface-intent.js';

export interface WordSelectConsumerDeps {
  /** Future hook — invoked when the gate passes. Callers should
   *  resolve the actual word via a buffer lookup keyed by
   *  surfaceId. */
  onWordSelect?: (intent: SerializableSurfaceIntent) => void;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export function createWordSelectConsumer(
  deps: WordSelectConsumerDeps = {},
): TerminalSurfaceIntentConsumer {
  return {
    id: 'word-select',
    priority: 50,
    handle(intent): TerminalSurfaceIntentResult {
      if (intent.kind !== 'word-select') {
        return { handled: false };
      }
      // G6 — gate on canInspect. Word extraction reads buffer state
      // (selection / copy / inspection layer per the strategic
      // ROADMAP §2). Without inspect capability we drop the intent.
      if (!intent.capability.canInspect) {
        return { handled: false, reason: 'no-canInspect' };
      }
      try { deps.onWordSelect?.(intent); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.word-select.applied', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
          userExposure: intent.exposure.userExposure,
        });
      }
      return { handled: true };
    },
  };
}
