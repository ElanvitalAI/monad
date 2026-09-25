// PR-2 placeholder consumer · caret-focus intent.
//
// Click-derived intent. Future product behavior: attach the clicked
// (row, col) to the next LLM turn's prompt as caret metadata so the
// agent can reason about where the user pointed.
//
// This commit lands a structurally complete consumer (capability gate +
// debug log) but leaves the actual prompt-attach to a future arc. The
// gate already enforces `canRead` per G6.

import type {
  TerminalSurfaceIntentConsumer,
  TerminalSurfaceIntentResult,
} from '../terminal-mouse-intent-runtime.js';
import type { SerializableSurfaceIntent } from '../terminal-surface-intent.js';

export interface CaretFocusConsumerDeps {
  /** Future hook — invoked with the caret coords when the gate
   *  passes. PR-2 placeholder leaves this optional; production
   *  wiring sets it to a function that pushes metadata into the
   *  next turn's prompt builder. */
  onCaretFocus?: (intent: SerializableSurfaceIntent) => void;
  /** Debug log injection — runtime owns the actual debug instance
   *  to avoid coupling this consumer to a global. */
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export function createCaretFocusConsumer(
  deps: CaretFocusConsumerDeps = {},
): TerminalSurfaceIntentConsumer {
  return {
    id: 'caret-focus',
    priority: 50,
    handle(intent): TerminalSurfaceIntentResult {
      if (intent.kind !== 'caret-focus') {
        return { handled: false };
      }
      // G6 — capability is gate. canRead means the surface buffer is
      // observable; without it caret coords are meaningless.
      if (!intent.capability.canRead) {
        return { handled: false, reason: 'no-canRead' };
      }
      try { deps.onCaretFocus?.(intent); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.caret-focus.applied', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
          userExposure: intent.exposure.userExposure,
        });
      }
      return { handled: true };
    },
  };
}
