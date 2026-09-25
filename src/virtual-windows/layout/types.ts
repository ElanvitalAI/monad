// ── VW-term-infra Phase 3a — LayoutSpec types ──
//
// Serializable layout description. Separate from the live runtime
// binary-tree at `src/virtual-windows/layout-tree.ts` (which owns split
// ratios + splits/close for the active VW) — the spec layer exists so
// layouts can be named, saved, loaded, shared as JSON, and reconstituted
// on a fresh session. The live binary tree is the source of truth at
// runtime; `toLayoutSpec(...)` snapshots it, `fromLayoutSpec(...)`
// rebuilds.
//
// Design:
//   - LayoutSpecNode supports four flavors: leaf / split (n-ary) / tabs /
//     float. Most sessions only emit leaf + split; tabs + float are
//     reserved for Phase 3b surface-promote + future tab-bar UX but
//     modelling them now keeps the JSON schema stable.
//   - PaneRef is the canonical `src/panes` address so the serialized
//     layout binds to the Pane substrate, not the addressing.ts
//     WindowId+PaneId numeric pair. This is intentional: Phase 4+
//     PaneVisualState reads per PaneRef, and the spec layer must align
//     so save→restore preserves identity.
//   - A version field pinned to 1 gates future migrations.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p3-p5` §3.3

import type { Rect } from '../../display/rect.js';
import type { PaneRef } from '../../panes/types.js';

/** The four LayoutSpec node flavors. See module header for scope. */
export type LayoutSpecNode =
  | { kind: 'leaf'; paneRef: PaneRef; size?: number }
  | {
      kind: 'split';
      axis: 'row' | 'col';
      children: readonly LayoutSpecNode[];
      sizes: readonly number[];
    }
  | { kind: 'tabs'; active: number; panes: readonly PaneRef[] }
  | { kind: 'float'; pane: PaneRef; rect: Rect };

/** A serializable, versioned layout for one virtual window. */
export interface LayoutSpec {
  readonly version: 1;
  readonly windowId: string;
  readonly root: LayoutSpecNode;
  readonly createdAt: number;
  readonly label?: string;
}

/** Current spec version. Bumped on any breaking shape change. */
export const LAYOUT_SPEC_VERSION = 1 as const;

/** Thrown when a LayoutSpec is structurally invalid. The detail is
 *  intentionally human-readable — persistence failures surface this
 *  message in error toasts / dashboard log. */
export class LayoutSpecValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${message} (at ${path})`);
    this.name = 'LayoutSpecValidationError';
  }
}
