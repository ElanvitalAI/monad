// PR-2 — placeholder consumer registry.
//
// `createDefaultConsumers` returns the four canonical consumers in
// priority order (lower number fires earlier; first handled=true wins):
//
//   40  context-menu  (right-click → context-action chooser)
//   50  caret-focus   (click → next-turn caret metadata)
//   50  word-select   (double-click → word extraction + clipboard)
//   60  viewport-scroll (wheel → scrollback)
//
// All four consumers honor G6: capability is gate, intent is meaning.
// Each guards on the relevant capability boolean(s) and rejects with
// a `reason:` so debug logs explain which gate blocked.

export {
  createCaretFocusConsumer,
  type CaretFocusConsumerDeps,
} from './caret-focus.consumer.js';
export {
  createContextMenuConsumer,
  type ContextMenuConsumerDeps,
} from './context-menu.consumer.js';
export {
  createViewportScrollConsumer,
  type ViewportScrollConsumerDeps,
} from './viewport-scroll.consumer.js';
export {
  createWordSelectConsumer,
  type WordSelectConsumerDeps,
} from './word-select.consumer.js';
export {
  createRangeSelectConsumer,
  type RangeSelectConsumerDeps,
  type RangeSelectSpec,
} from './range-select.consumer.js';

import type { TerminalSurfaceIntentConsumer } from '../terminal-mouse-intent-runtime.js';
import { createCaretFocusConsumer, type CaretFocusConsumerDeps } from './caret-focus.consumer.js';
import { createContextMenuConsumer, type ContextMenuConsumerDeps } from './context-menu.consumer.js';
import { createViewportScrollConsumer, type ViewportScrollConsumerDeps } from './viewport-scroll.consumer.js';
import { createWordSelectConsumer, type WordSelectConsumerDeps } from './word-select.consumer.js';
import { createRangeSelectConsumer, type RangeSelectConsumerDeps } from './range-select.consumer.js';

export interface DefaultConsumerDeps {
  caretFocus?: CaretFocusConsumerDeps;
  contextMenu?: ContextMenuConsumerDeps;
  viewportScroll?: ViewportScrollConsumerDeps;
  wordSelect?: WordSelectConsumerDeps;
  /** X1 (Phase 1) — drag DS-4d × text region consumer. Optional —
   *  when omitted the chain still includes a no-op range-select
   *  consumer so range intents don't fall through unhandled. */
  rangeSelect?: RangeSelectConsumerDeps;
}

/**
 * PR-2 — convenience helper that constructs the canonical
 * placeholder consumers. Production callers (dashboard boot) use this
 * to register all consumers at once. Tests can call directly to
 * introspect priority ordering.
 *
 * X1 added the `range-select` consumer (priority 45) that handles
 * `range-select-update` / `range-select-end` intents from the
 * drag-session DS-4d arc.
 */
export function createDefaultConsumers(
  deps: DefaultConsumerDeps = {},
): TerminalSurfaceIntentConsumer[] {
  return [
    createContextMenuConsumer(deps.contextMenu),
    createRangeSelectConsumer(deps.rangeSelect),
    createCaretFocusConsumer(deps.caretFocus),
    createWordSelectConsumer(deps.wordSelect),
    createViewportScrollConsumer(deps.viewportScroll),
  ];
}
