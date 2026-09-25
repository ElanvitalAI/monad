// ── VW-term-infra Phase 3a — binary-tree ↔ LayoutSpec adapter ──
//
// Bridges the live runtime binary tree (`src/virtual-windows/layout-tree.ts`)
// with the serializable `LayoutSpec`. Used by:
//   - save path : snapshot the current VW → persist
//   - load path : restore persisted spec → binary tree ready for the
//                 VW registry
//
// Binary tree (live runtime) node shape:
//   - axis 'h' = horizontal split = side-by-side columns
//   - axis 'v' = vertical   split = stacked rows
//   - `ratio` = fraction going to child `a` (left / top)
//
// LayoutSpec node shape is n-ary + richer; the adapter reads the
// common subset (leaf + split) and right-folds n-ary split specs into
// a chain of binary splits so the runtime tree receives exactly the
// two-children form it expects.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p3-p5` §3.4 (C11 · adapter)

import type {
  LayoutNode as BinaryLayoutNode,
  Axis as BinaryAxis,
} from '../layout-tree.js';
import type { PaneRef } from '../../panes/types.js';
import {
  LayoutSpecValidationError,
  LAYOUT_SPEC_VERSION,
  type LayoutSpec,
  type LayoutSpecNode,
} from './types.js';

/** Convert a live binary tree into a LayoutSpec. Every leaf paneId is
 *  paired with the supplied `windowId` to form the spec's canonical
 *  `PaneRef`. Tabs / float nodes never appear on the save path (the
 *  binary tree has no representation for either) — those are preset-
 *  only constructs for now. */
export function fromBinaryTree(opts: {
  windowId: string;
  root: BinaryLayoutNode;
  label?: string;
  createdAt?: number;
}): LayoutSpec {
  const createdAt = opts.createdAt ?? Date.now();
  return {
    version: LAYOUT_SPEC_VERSION,
    windowId: opts.windowId,
    createdAt,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    root: binaryToSpec(opts.root, opts.windowId),
  };
}

/** Convert a LayoutSpec back into a live binary tree. Throws
 *  `LayoutSpecValidationError` for constructs the runtime tree cannot
 *  express (tabs / float) — callers handle those separately, e.g. by
 *  materializing tabs nodes outside the binary tree. */
export function toBinaryTree(spec: LayoutSpec): BinaryLayoutNode {
  return specToBinary(spec.root);
}

function binaryToSpec(node: BinaryLayoutNode, windowId: string): LayoutSpecNode {
  if (node.kind === 'leaf') {
    const paneRef: PaneRef = { windowId, paneId: node.paneId };
    return { kind: 'leaf', paneRef };
  }
  const ratio = clampRatio(node.ratio);
  return {
    kind: 'split',
    axis: binaryAxisToSpec(node.axis),
    children: [
      binaryToSpec(node.a, windowId),
      binaryToSpec(node.b, windowId),
    ],
    sizes: [ratio, 1 - ratio],
  };
}

function specToBinary(node: LayoutSpecNode): BinaryLayoutNode {
  switch (node.kind) {
    case 'leaf':
      return { kind: 'leaf', paneId: node.paneRef.paneId };
    case 'split': {
      const axis = specAxisToBinary(node.axis);
      // Right-fold n-ary splits into a chain of binary splits.
      // Example sizes [0.25, 0.25, 0.25, 0.25] → ratio chain
      //   split(0.25, A, split(0.333, B, split(0.5, C, D)))
      // preserving the total width contribution per leaf.
      const children = node.children;
      const sizes = node.sizes;
      const n = children.length;
      if (n < 2) {
        throw new LayoutSpecValidationError(
          `split with < 2 children cannot lower to binary tree`,
          'split.children',
        );
      }
      let remainingSum = 0;
      for (let i = 1; i < n; i++) remainingSum += sizes[i]!;
      // Build right-to-left.
      let right: BinaryLayoutNode = specToBinary(children[n - 1]!);
      for (let i = n - 2; i >= 1; i--) {
        const leftWeight = sizes[i]!;
        const rightWeight = remainingSum - leftWeight;
        const ratio = leftWeight / (leftWeight + rightWeight);
        right = {
          kind: 'split',
          axis,
          ratio: clampRatio(ratio),
          a: specToBinary(children[i]!),
          b: right,
        };
        remainingSum -= leftWeight;
      }
      const totalAfterFirst = sizes.slice(1).reduce((a, b) => a + b, 0);
      const rootRatio = sizes[0]! / (sizes[0]! + totalAfterFirst);
      return {
        kind: 'split',
        axis,
        ratio: clampRatio(rootRatio),
        a: specToBinary(children[0]!),
        b: right,
      };
    }
    case 'tabs':
    case 'float':
      throw new LayoutSpecValidationError(
        `${node.kind} nodes cannot lower to the binary runtime tree`,
        `root.${node.kind}`,
      );
  }
}

function binaryAxisToSpec(axis: BinaryAxis): 'row' | 'col' {
  return axis === 'h' ? 'col' : 'row';
}

function specAxisToBinary(axis: 'row' | 'col'): BinaryAxis {
  return axis === 'col' ? 'h' : 'v';
}

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.5;
  if (r < 0.1) return 0.1;
  if (r > 0.9) return 0.9;
  return r;
}
