// ── VW-term-infra Phase 3a — binary tree ↔ LayoutSpec adapter tests ──
//
// Lock in the adapter's contract:
//   - binaryToSpec(root) preserves leaf paneIds + split axes + ratios
//   - specToBinary(root) handles n-ary splits via right-fold
//   - round-trip (binary → spec → binary) is shape-preserving
//   - tabs/float nodes throw on the lowering path (expected)

import { describe, expect, test } from 'bun:test';

import type { LayoutNode as BinaryLayoutNode } from '../../../src/virtual-windows/layout-tree.js';
import {
  LayoutSpecValidationError,
  fromBinaryTree,
  toBinaryTree,
  type LayoutSpec,
} from '../../../src/virtual-windows/layout/index.js';

function leaf(id: string): BinaryLayoutNode {
  return { kind: 'leaf', paneId: id };
}
function split(
  axis: 'h' | 'v',
  a: BinaryLayoutNode,
  b: BinaryLayoutNode,
  ratio = 0.5,
): BinaryLayoutNode {
  return { kind: 'split', axis, a, b, ratio };
}

describe('Phase 3a · binaryToSpec', () => {
  test('single leaf → spec leaf with windowId-paired PaneRef', () => {
    const spec = fromBinaryTree({ windowId: 'w:42', root: leaf('p-a') });
    expect(spec.root.kind).toBe('leaf');
    if (spec.root.kind === 'leaf') {
      expect(spec.root.paneRef).toEqual({ windowId: 'w:42', paneId: 'p-a' });
    }
  });

  test('h split → col axis; v split → row axis', () => {
    const hSpec = fromBinaryTree({
      windowId: 'w', root: split('h', leaf('a'), leaf('b'), 0.4),
    });
    expect(hSpec.root.kind).toBe('split');
    if (hSpec.root.kind === 'split') {
      expect(hSpec.root.axis).toBe('col');
      expect(hSpec.root.sizes).toEqual([0.4, 0.6]);
    }
    const vSpec = fromBinaryTree({
      windowId: 'w', root: split('v', leaf('a'), leaf('b'), 0.7),
    });
    if (vSpec.root.kind === 'split') {
      expect(vSpec.root.axis).toBe('row');
      expect(vSpec.root.sizes[0]).toBeCloseTo(0.7);
      expect(vSpec.root.sizes[1]).toBeCloseTo(0.3);
    }
  });

  test('createdAt + label are stamped', () => {
    const spec = fromBinaryTree({
      windowId: 'w', root: leaf('a'),
      label: 'test', createdAt: 12345,
    });
    expect(spec.createdAt).toBe(12345);
    expect(spec.label).toBe('test');
  });
});

describe('Phase 3a · specToBinary', () => {
  test('binary split round-trips', () => {
    const orig = split('v', leaf('a'), leaf('b'), 0.3);
    const spec = fromBinaryTree({ windowId: 'w', root: orig });
    const back = toBinaryTree(spec);
    expect(back.kind).toBe('split');
    if (back.kind === 'split') {
      expect(back.axis).toBe('v');
      expect(back.ratio).toBeCloseTo(0.3);
      expect(back.a).toEqual({ kind: 'leaf', paneId: 'a' });
      expect(back.b).toEqual({ kind: 'leaf', paneId: 'b' });
    }
  });

  test('n-ary split right-folds into binary chain', () => {
    const spec: LayoutSpec = {
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'split', axis: 'col',
        sizes: [0.25, 0.25, 0.25, 0.25],
        children: [
          { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'a' } },
          { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'b' } },
          { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'c' } },
          { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'd' } },
        ],
      },
    };
    const root = toBinaryTree(spec);
    // Right-fold: root = split('h', a, split('h', b, split('h', c, d)))
    expect(root.kind).toBe('split');
    if (root.kind === 'split') {
      expect(root.axis).toBe('h');
      expect(root.a).toEqual({ kind: 'leaf', paneId: 'a' });
      expect(root.b.kind).toBe('split');
      if (root.b.kind === 'split') {
        expect(root.b.a).toEqual({ kind: 'leaf', paneId: 'b' });
        expect(root.b.b.kind).toBe('split');
        if (root.b.b.kind === 'split') {
          expect(root.b.b.a).toEqual({ kind: 'leaf', paneId: 'c' });
          expect(root.b.b.b).toEqual({ kind: 'leaf', paneId: 'd' });
        }
      }
    }
  });

  test('tabs node cannot lower to binary tree', () => {
    const spec: LayoutSpec = {
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'tabs', active: 0,
        panes: [{ windowId: 'w', paneId: 'p' }],
      },
    };
    expect(() => toBinaryTree(spec)).toThrow(LayoutSpecValidationError);
  });

  test('float node cannot lower to binary tree', () => {
    const spec: LayoutSpec = {
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'float',
        pane: { windowId: 'w', paneId: 'p' },
        rect: { row: 0, col: 0, width: 10, height: 5 },
      },
    };
    expect(() => toBinaryTree(spec)).toThrow(LayoutSpecValidationError);
  });
});

describe('Phase 3a · binary ↔ spec round-trip invariants', () => {
  test('nested binary tree round-trip preserves leaf set', () => {
    const orig = split('h',
      leaf('a'),
      split('v', leaf('b'), split('h', leaf('c'), leaf('d'), 0.2), 0.7),
      0.4,
    );
    const spec = fromBinaryTree({ windowId: 'w', root: orig });
    const back = toBinaryTree(spec);
    expect(collectLeafIds(back).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('ratio within [0.1, 0.9] is preserved ±1e-9', () => {
    const orig = split('h', leaf('a'), leaf('b'), 0.35);
    const spec = fromBinaryTree({ windowId: 'w', root: orig });
    const back = toBinaryTree(spec);
    if (back.kind === 'split') {
      expect(back.ratio).toBeCloseTo(0.35, 9);
    }
  });
});

function collectLeafIds(node: BinaryLayoutNode): string[] {
  if (node.kind === 'leaf') return [node.paneId];
  return [...collectLeafIds(node.a), ...collectLeafIds(node.b)];
}
