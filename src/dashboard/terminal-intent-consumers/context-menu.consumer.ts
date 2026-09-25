// PR-2 placeholder consumer · context-menu intent (right-click).
//
// Right-click is the canonical entry point for terminal-surface
// context actions: "open in browser", "copy file path", "lookup symbol",
// etc. The existing `mouse-action-recipes` chooser substrate is the
// natural target; PR-2 lands the consumer hook so future product work
// can wire the chooser without re-plumbing dispatch.

import type {
  TerminalSurfaceIntentConsumer,
  TerminalSurfaceIntentResult,
} from '../terminal-mouse-intent-runtime.js';
import type { SerializableSurfaceIntent } from '../terminal-surface-intent.js';

export interface ContextMenuConsumerDeps {
  /** Future hook — invoked to open a context-action chooser anchored
   *  at (row, col). Production wiring will route this into the
   *  mouse-action-recipes substrate. */
  onContextMenu?: (intent: SerializableSurfaceIntent) => void;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export function createContextMenuConsumer(
  deps: ContextMenuConsumerDeps = {},
): TerminalSurfaceIntentConsumer {
  return {
    id: 'context-menu',
    priority: 40,
    handle(intent): TerminalSurfaceIntentResult {
      if (intent.kind !== 'context-menu') {
        return { handled: false };
      }
      // G6 — context actions span read + inspect; both must be true
      // for the chooser to be meaningful (copy / open / lookup all
      // depend on reading the surface).
      if (!intent.capability.canRead || !intent.capability.canInspect) {
        return { handled: false, reason: 'no-read-or-inspect' };
      }
      try { deps.onContextMenu?.(intent); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.context-menu.applied', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
        });
      }
      return { handled: true };
    },
  };
}
