// ── I.2.2 · DragEscInterceptor — A-8 ESC guard migration ──
//
// Wraps the A-8 rule ("ESC during an active drag cancels the drag
// and is consumed before any viewMode arm runs") as a
// `KeyInterceptor`. Behavioural contract is identical to the
// hard-coded branch that previously lived in
// `input-core/dispatcher.ts:163-180` — only the location moved.
//
// Priority 100 · urgent state-gated cancellation. Must run before any
// future global-shortcut interceptor (priority 50) so that an ESC
// during a drag never reaches chord leaders / modal arms with drag
// still live.
//
// See:
//   - PLAN-compositor-i2-interceptor-registry.md §2 Phase I.2.2
//   - PR #308 §5.5 · original A-8 introduction
//   - 3-way convergence comment on PR #306
//     https://github.com/ElanvitalAI/elanous/pull/306#issuecomment-4284981117

import type { KeyInterceptor } from './interceptor.js';
import type { DragManager } from '../primitives/drag-session/index.js';

/** Build the A-8 DragEsc guard as a `KeyInterceptor`. The caller owns
 *  the `DragManager` instance (usually `display.dragManagerAPI()`);
 *  this factory captures it by closure so the interceptor only reads
 *  `isActive()` / `cancelAll()` and never gets restructured. */
export function createDragEscInterceptor(
  dragManager: DragManager,
): KeyInterceptor {
  return {
    name: 'drag-esc-cancel',
    priority: 100,
    intercept(ev, _ctx) {
      if (ev.kind !== 'key') return 'passthrough';
      if (ev.key.name !== 'escape') return 'passthrough';
      if (!dragManager.isActive()) return 'passthrough';
      dragManager.cancelAll('escape');
      return 'consumed';
    },
  };
}
