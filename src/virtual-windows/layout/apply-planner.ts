// ── VW-term-infra Bundle A · A1 — Layout apply planner ──
//
// Turns a `RestorePlan` (pure data from `restore-planner.ts`) into a
// concrete action list a dashboard can execute against the live
// `VirtualWindow` / `WindowRegistry`. Keeps execution out of this
// module — same discipline as `restore-planner` — so the hermetic
// test path runs without any VW internals.
//
// Scope (Bundle A · A1):
//   - `computeApplyActions(plan, currentPaneIds)` → `LayoutApplyAction[]`
//   - `applyLayoutPlan(plan, deps)` → runs the action list through an
//     injected executor · returns `{ applied, skipped, warnings }`
//   - Executor deps are Optional-method · missing methods mean "no-op
//     + report warning" so dashboards can opt into deletion-only
//     today and spawn/focus later
//
// Deferred to a follow-up bundle:
//   - Binary tree rebuild (`setLayoutTree(root)`) — needs VW internals
//     extension. `reshape` actions are surfaced here but executor
//     returns warning until VW exposes the setter.
//   - Pane spawn semantics — caller decides content factory; we just
//     emit the PaneRef so the caller can map to its own spawn path.

import { allPaneIds, type LayoutNode as BinaryLayoutNode } from '../layout-tree.js';
import type { PaneRef } from '../../panes/types.js';
import type { RestorePlan } from './restore-planner.js';

export type LayoutApplyAction =
  | { readonly kind: 'close'; readonly paneId: string }
  | { readonly kind: 'spawn'; readonly paneRef: PaneRef }
  | { readonly kind: 'focus'; readonly paneId: string }
  | { readonly kind: 'reshape'; readonly binaryRoot: BinaryLayoutNode };

export interface LayoutApplyExecutor {
  /** Returns true when the pane was closed, false when skipped. */
  closePane?(paneId: string): boolean;
  /** Returns true when the pane was created, false when skipped. */
  spawnPane?(paneRef: PaneRef): boolean;
  /** Returns true on success. */
  setFocus?(paneId: string): boolean;
  /** Apply a binary layout tree snapshot. Optional — when missing, the
   *  `reshape` action is logged as a warning instead of being executed. */
  setLayoutTree?(binaryRoot: BinaryLayoutNode): boolean;
}

export interface ApplyLayoutResult {
  readonly applied: number;
  readonly skipped: readonly LayoutApplyAction[];
  readonly warnings: readonly string[];
}

/** Pure compute of the action list. Walk `availablePaneIds` and plan's
 *  binary root (leaf ids) to emit close / spawn actions; emit one
 *  `reshape` per non-null binaryRoot; emit `focus` only when the caller
 *  supplies a desired focus target via `focusPaneId`. */
export function computeApplyActions(
  plan: RestorePlan,
  currentPaneIds: ReadonlySet<string>,
  opts: { readonly focusPaneId?: string; readonly windowId?: string } = {},
): readonly LayoutApplyAction[] {
  const actions: LayoutApplyAction[] = [];

  // Ids referenced by the plan (surviving binary tree + missing).
  const planIds = new Set<string>();
  if (plan.binaryRoot) {
    for (const p of allPaneIds(plan.binaryRoot)) planIds.add(p);
  }
  for (const m of plan.missing) planIds.add(m.paneId);

  // 1. Close: pane in current but not in plan.
  for (const paneId of currentPaneIds) {
    if (!planIds.has(paneId)) {
      actions.push({ kind: 'close', paneId });
    }
  }

  // 2. Spawn: leaf in plan.binaryRoot but not in current.
  if (plan.binaryRoot) {
    const seen = new Set<string>();
    for (const paneId of allPaneIds(plan.binaryRoot)) {
      if (seen.has(paneId)) continue;
      seen.add(paneId);
      if (!currentPaneIds.has(paneId)) {
        actions.push({
          kind: 'spawn',
          paneRef: { windowId: opts.windowId ?? '', paneId },
        });
      }
    }
  }

  // 3. Reshape: plan has a binary root to install.
  if (plan.binaryRoot) {
    actions.push({ kind: 'reshape', binaryRoot: plan.binaryRoot });
  }

  // 4. Focus: only when caller specified.
  if (opts.focusPaneId) {
    actions.push({ kind: 'focus', paneId: opts.focusPaneId });
  }

  return actions;
}

/** Execute a previously-computed action list against the injected
 *  executor. Missing executor methods cause the corresponding action to
 *  be recorded as `skipped` with a warning — callers opt into
 *  deletion-only / focus-only subsets without stubs. */
export function applyLayoutPlan(
  plan: RestorePlan,
  deps: LayoutApplyExecutor,
  opts: {
    readonly focusPaneId?: string;
    readonly windowId?: string;
    readonly currentPaneIds: ReadonlySet<string>;
  },
): ApplyLayoutResult {
  const actions = computeApplyActions(plan, opts.currentPaneIds, {
    ...(opts.focusPaneId !== undefined ? { focusPaneId: opts.focusPaneId } : {}),
    ...(opts.windowId !== undefined ? { windowId: opts.windowId } : {}),
  });
  const skipped: LayoutApplyAction[] = [];
  const warnings: string[] = [];
  let applied = 0;

  for (const action of actions) {
    switch (action.kind) {
      case 'close': {
        if (!deps.closePane) {
          skipped.push(action);
          warnings.push(`close ${action.paneId} skipped: no closePane executor`);
          break;
        }
        if (deps.closePane(action.paneId)) {
          applied += 1;
        } else {
          skipped.push(action);
          warnings.push(`close ${action.paneId} returned false`);
        }
        break;
      }
      case 'spawn': {
        if (!deps.spawnPane) {
          skipped.push(action);
          warnings.push(`spawn ${action.paneRef.paneId} skipped: no spawnPane executor`);
          break;
        }
        if (deps.spawnPane(action.paneRef)) {
          applied += 1;
        } else {
          skipped.push(action);
          warnings.push(`spawn ${action.paneRef.paneId} returned false`);
        }
        break;
      }
      case 'reshape': {
        if (!deps.setLayoutTree) {
          skipped.push(action);
          warnings.push('reshape skipped: no setLayoutTree executor');
          break;
        }
        if (deps.setLayoutTree(action.binaryRoot)) {
          applied += 1;
        } else {
          skipped.push(action);
          warnings.push('reshape setLayoutTree returned false');
        }
        break;
      }
      case 'focus': {
        if (!deps.setFocus) {
          skipped.push(action);
          warnings.push(`focus ${action.paneId} skipped: no setFocus executor`);
          break;
        }
        if (deps.setFocus(action.paneId)) {
          applied += 1;
        } else {
          skipped.push(action);
          warnings.push(`focus ${action.paneId} returned false`);
        }
        break;
      }
    }
  }

  return { applied, skipped, warnings };
}

