// ── VW-term-infra Phase 3a — LayoutSpec restore planner ──
//
// Pure planner that turns a persisted `LayoutSpec` into a step-by-step
// plan for reconstructing the VW runtime. Isolates the decision-making
// (which panes are available, what falls back) from the side-effectful
// mount/spawn work that the dashboard owns — keeps substrate code free
// of UI lifecycle coupling per LESSONS L5.
//
// The planner does NOT:
//   - Spawn panes (caller provides `availablePaneIds` snapshot)
//   - Mount binary trees into the registry
//   - Persist restore decisions
//
// It DOES:
//   - Walk the spec tree, resolve each leaf's PaneRef against the
//     available set, and record missing panes
//   - Lower split nodes to binary chains (delegating to `toBinaryTree`
//     via per-subtree conversion when the whole subtree is realizable)
//   - Skip tabs/float nodes, collecting them as `unsupported` so the
//     caller can render them elsewhere (tab bar, popover) once Phase 3b
//     SurfaceRole lands
//   - Produce a placeholder pane-id substitution for missing leaves
//     when the caller opts into placeholder-on-missing mode
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p3-p5` §3.5 (C12 restore) ·
//      내부 문서 `CAPABILITIES-vw-layout-spec` §7

import type { Rect } from '../../display/rect.js';
import type { PaneRef } from '../../panes/types.js';
import type { LayoutNode as BinaryLayoutNode } from '../layout-tree.js';
import { fromBinaryTree, toBinaryTree } from './tree.js';
import { LayoutSpecValidationError, type LayoutSpec, type LayoutSpecNode } from './types.js';

/** Inputs that shape the restore decision. */
export interface RestorePlanInput {
  readonly spec: LayoutSpec;
  /** PaneIds the caller can definitely re-attach right now. Usually the
   *  union of existing VW pane registrations + whatever the caller is
   *  about to spawn. Missing leaves are listed in `missing` so the
   *  caller can decide to spawn, skip, or substitute. */
  readonly availablePaneIds: ReadonlySet<string>;
  /** When true, missing leaves are kept in the binary tree using the
   *  same paneId as the spec called out — the caller's composer is
   *  expected to render a placeholder pane for unknown ids. When false
   *  (default), missing leaves are omitted from the tree and reported
   *  solely in `missing`; split nodes with zero surviving children
   *  collapse and their siblings' sizes re-normalize. */
  readonly keepMissingAsPlaceholder?: boolean;
}

/** What the planner produces. Everything is immutable, so the caller
 *  can examine the plan, ask the user for confirmation, then act. */
export interface RestorePlan {
  /** The binary tree ready to hand to the VW runtime registry.
   *  `null` when the entire spec reduced to unsupported/missing and
   *  no runnable subtree remains. */
  readonly binaryRoot: BinaryLayoutNode | null;
  /** PaneRefs the spec calls out that were not in availablePaneIds. */
  readonly missing: readonly PaneRef[];
  /** Tabs containers encountered. Caller renders these via tab-bar
   *  widget (Phase 3b). Empty until LayoutSpec authors start using
   *  the tabs kind. */
  readonly tabs: readonly TabsPlanEntry[];
  /** Float containers encountered. Caller renders these via popover
   *  surface (Phase 3b). Empty for today's preset library. */
  readonly floats: readonly FloatPlanEntry[];
  /** Non-fatal diagnostics captured during planning. */
  readonly notes: readonly string[];
}

export interface TabsPlanEntry {
  readonly panes: readonly PaneRef[];
  readonly active: number;
}

export interface FloatPlanEntry {
  readonly pane: PaneRef;
  readonly rect: Rect;
}

/** Plan the restore of a LayoutSpec against the currently-available
 *  pane population. Pure; throws only on structurally invalid specs
 *  that slipped past `validateSpec` (adapter bugs, not user error). */
export function planRestore(input: RestorePlanInput): RestorePlan {
  const missing: PaneRef[] = [];
  const tabs: TabsPlanEntry[] = [];
  const floats: FloatPlanEntry[] = [];
  const notes: string[] = [];
  const keepMissing = input.keepMissingAsPlaceholder === true;

  const spec = input.spec;
  const pruned = prune(
    spec.root,
    input.availablePaneIds,
    { missing, tabs, floats, notes, keepMissing },
  );

  if (pruned === null) {
    return {
      binaryRoot: null,
      missing,
      tabs,
      floats,
      notes,
    };
  }

  // Re-wrap into a LayoutSpec shell so we can reuse the existing
  // spec→binary lowerer; the pruner returned a tree that contains only
  // leaf + split nodes (tabs/float already extracted), so this is safe.
  const dummySpec: LayoutSpec = {
    version: spec.version,
    windowId: spec.windowId,
    createdAt: spec.createdAt,
    ...(spec.label !== undefined ? { label: spec.label } : {}),
    root: pruned,
  };
  let binaryRoot: BinaryLayoutNode;
  try {
    binaryRoot = toBinaryTree(dummySpec);
  } catch (err) {
    if (err instanceof LayoutSpecValidationError) {
      notes.push(`lowering failed: ${err.message}`);
      return { binaryRoot: null, missing, tabs, floats, notes };
    }
    throw err;
  }

  return {
    binaryRoot,
    missing,
    tabs,
    floats,
    notes,
  };
}

/** Convenience wrapper that mirrors the save-path ergonomics.
 *  Equivalent to `fromBinaryTree({windowId, root: currentTree, label, createdAt})`
 *  but lives alongside the restore entry so callers find both
 *  directions in one module. */
export function snapshotWindow(opts: {
  readonly windowId: string;
  readonly root: BinaryLayoutNode;
  readonly label?: string;
  readonly createdAt?: number;
}): LayoutSpec {
  return fromBinaryTree(opts);
}

// ── Internals ──────────────────────────────────────────────────

interface PruneCtx {
  missing: PaneRef[];
  tabs: TabsPlanEntry[];
  floats: FloatPlanEntry[];
  notes: string[];
  keepMissing: boolean;
}

/** Walk the spec tree and produce a leaner version containing only
 *  leaf + split nodes. Missing leaves either get retained (placeholder
 *  mode) or are removed — split nodes with fewer than 2 surviving
 *  children collapse or vanish. Tabs/float nodes are siphoned off. */
function prune(
  node: LayoutSpecNode,
  available: ReadonlySet<string>,
  ctx: PruneCtx,
): LayoutSpecNode | null {
  if (node.kind === 'leaf') {
    if (available.has(node.paneRef.paneId)) return node;
    ctx.missing.push(node.paneRef);
    if (ctx.keepMissing) return node;
    ctx.notes.push(`dropped missing leaf ${node.paneRef.paneId}`);
    return null;
  }
  if (node.kind === 'tabs') {
    const present: PaneRef[] = [];
    const missing: PaneRef[] = [];
    for (const p of node.panes) {
      if (available.has(p.paneId)) present.push(p);
      else missing.push(p);
    }
    ctx.missing.push(...missing);
    if (present.length > 0) {
      const active = Math.min(node.active, present.length - 1);
      ctx.tabs.push({ panes: present, active });
    } else {
      ctx.notes.push('tabs container with no available panes');
    }
    return null; // tabs don't lower to binary tree
  }
  if (node.kind === 'float') {
    if (available.has(node.pane.paneId)) {
      ctx.floats.push({ pane: node.pane, rect: node.rect });
    } else {
      ctx.missing.push(node.pane);
      ctx.notes.push(`dropped missing float pane ${node.pane.paneId}`);
    }
    return null;
  }
  // Split — recurse
  const survivingChildren: LayoutSpecNode[] = [];
  const survivingSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const pruned = prune(node.children[i]!, available, ctx);
    if (pruned !== null) {
      survivingChildren.push(pruned);
      survivingSizes.push(node.sizes[i]!);
    }
  }
  if (survivingChildren.length === 0) return null;
  if (survivingChildren.length === 1) return survivingChildren[0]!;
  // Re-normalize sizes so they sum to 1 again.
  const sum = survivingSizes.reduce((a, b) => a + b, 0);
  const normalized = survivingSizes.map((s) => s / sum);
  return {
    kind: 'split',
    axis: node.axis,
    children: survivingChildren,
    sizes: normalized,
  };
}
