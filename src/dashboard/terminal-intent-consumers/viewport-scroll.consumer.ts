// PR-2 placeholder consumer · viewport-scroll intent (scroll-up / scroll-down).
//
// PTY-forward transport already handles in-app scroll for terminal
// programs that opt into mouse mode. The host-side intent here is for
// preview / external panes where scroll should manipulate scrollback
// rather than forward to PTY.
//
// Future product behavior: walk back through preview buffer history
// (scroll-up) or forward (scroll-down). PR-2 lands the dispatch
// scaffolding only.

import type {
  TerminalSurfaceIntentConsumer,
  TerminalSurfaceIntentResult,
} from '../terminal-mouse-intent-runtime.js';
import type { SerializableSurfaceIntent } from '../terminal-surface-intent.js';

export interface ViewportScrollConsumerDeps {
  onViewportScroll?: (intent: SerializableSurfaceIntent) => void;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export function createViewportScrollConsumer(
  deps: ViewportScrollConsumerDeps = {},
): TerminalSurfaceIntentConsumer {
  return {
    id: 'viewport-scroll',
    priority: 60,
    handle(intent): TerminalSurfaceIntentResult {
      if (intent.kind !== 'viewport-scroll') {
        return { handled: false };
      }
      // G6 — canRead gate; scrollback is meaningful only when the
      // user can observe output.
      if (!intent.capability.canRead) {
        return { handled: false, reason: 'no-canRead' };
      }
      try { deps.onViewportScroll?.(intent); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.viewport-scroll.applied', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
        });
      }
      return { handled: true };
    },
  };
}
