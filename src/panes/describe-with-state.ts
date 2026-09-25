// ── VW-term-infra Bundle B-1 · B1-2 — describe-with-state helper ──
//
// Pure combiner that merges `describePane(opts)` (pane title / summary
// / kind / supportedTaps / chords / tools) with the `PaneVisualState`
// 4-tuple from Bundle A's store. Backs the `DescribePane` LLM tool
// without pulling `capture/` + `panes/visual-state` into one place.
//
// No side effects — returns a structured result either way so the LLM
// sees {found: false, note} on lookup miss instead of exception.
//
// See: PLAN-vw-term-bundle-b1-symmetry-foundation.md §2.2

import { describePane } from '../capture/sources/pane-source.js';
import type { PaneDescription, PaneRef } from './types.js';
import type {
  PaneVisualState,
  PaneVisualStateStore,
} from './visual-state.js';

export interface DescribeWithStateDeps {
  readonly store: PaneVisualStateStore;
}

export interface DescribePaneWithStateResult {
  readonly found: boolean;
  readonly ref: PaneRef;
  readonly description?: PaneDescription;
  readonly visualState?: PaneVisualState;
  readonly note?: string;
}

/** Resolve the pane via `capture/sources/pane-source#describePane` and
 *  layer the Bundle-A visualState on top. When pane lookup misses,
 *  still returns the visualState (default when unset) so an LLM can
 *  observe `{focusPolicy: 'skip'}` pre-seeded by a prior call. */
export function describePaneWithState(
  ref: PaneRef,
  deps: DescribeWithStateDeps,
): DescribePaneWithStateResult {
  const description = describePane({
    windowId: ref.windowId,
    paneId: ref.paneId,
    ...(ref.runnerLabel !== undefined ? { runnerLabel: ref.runnerLabel } : {}),
  });
  const visualState = deps.store.snapshot(ref);
  if (!description) {
    return {
      found: false,
      ref,
      visualState,
      note: 'pane not resolved through PaneFactory',
    };
  }
  return { found: true, ref, description, visualState };
}
