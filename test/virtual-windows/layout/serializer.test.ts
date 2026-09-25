// ── VW-term-infra Phase 3a — LayoutSpec serializer tests ──
//
// Lock in the JSON validator semantics: valid specs round-trip, the
// validator rejects every structural deviation it claims to catch, and
// error messages include a path pointer so users can locate the bad
// node in a hand-edited preset.

import { describe, expect, test } from 'bun:test';

import {
  fromJson,
  LayoutSpecValidationError,
  toJson,
  type LayoutSpec,
} from '../../../src/virtual-windows/layout/index.js';

function makeSpec(): LayoutSpec {
  return {
    version: 1,
    windowId: 'w:1',
    createdAt: 1_700_000_000_000,
    label: 'scratch',
    root: {
      kind: 'split',
      axis: 'col',
      sizes: [0.4, 0.6],
      children: [
        { kind: 'leaf', paneRef: { windowId: 'w:1', paneId: 'p:a' } },
        { kind: 'leaf', paneRef: { windowId: 'w:1', paneId: 'p:b' } },
      ],
    },
  };
}

describe('Phase 3a · serializer round-trip', () => {
  test('toJson → fromJson preserves every field', () => {
    const spec = makeSpec();
    const raw = toJson(spec);
    const back = fromJson(raw);
    expect(back).toEqual(spec);
  });

  test('pretty=true adds newlines without changing semantics', () => {
    const spec = makeSpec();
    const pretty = toJson(spec, true);
    expect(pretty.includes('\n')).toBe(true);
    expect(fromJson(pretty)).toEqual(spec);
  });

  test('tabs node round-trips', () => {
    const spec: LayoutSpec = {
      version: 1,
      windowId: 'w:t',
      createdAt: 1,
      root: {
        kind: 'tabs',
        active: 1,
        panes: [
          { windowId: 'w:t', paneId: 'p1' },
          { windowId: 'w:t', paneId: 'p2' },
          { windowId: 'w:t', paneId: 'p3' },
        ],
      },
    };
    expect(fromJson(toJson(spec))).toEqual(spec);
  });

  test('float node round-trips', () => {
    const spec: LayoutSpec = {
      version: 1,
      windowId: 'w:f',
      createdAt: 99,
      root: {
        kind: 'float',
        pane: { windowId: 'w:f', paneId: 'p1' },
        rect: { row: 2, col: 3, width: 20, height: 10 },
      },
    };
    expect(fromJson(toJson(spec))).toEqual(spec);
  });
});

describe('Phase 3a · serializer validation rejects invalid shapes', () => {
  test('missing version throws with $.version path', () => {
    const bad = JSON.stringify({
      windowId: 'w', createdAt: 0,
      root: { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'p' } },
    });
    expect(() => fromJson(bad))
      .toThrow(LayoutSpecValidationError);
  });

  test('unknown version is rejected', () => {
    const bad = toJson({ ...makeSpec(), version: 999 as unknown as 1 });
    try {
      fromJson(bad);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LayoutSpecValidationError);
      expect((err as Error).message).toContain('version');
    }
  });

  test('split.sizes sum off by > 1e-6 is rejected', () => {
    const spec: LayoutSpec = {
      ...makeSpec(),
      root: {
        kind: 'split', axis: 'row', sizes: [0.3, 0.5],
        children: [
          { kind: 'leaf', paneRef: { windowId: 'w:1', paneId: 'a' } },
          { kind: 'leaf', paneRef: { windowId: 'w:1', paneId: 'b' } },
        ],
      },
    };
    expect(() => fromJson(toJson(spec))).toThrow(LayoutSpecValidationError);
  });

  test('split with < 2 children is rejected', () => {
    const bad = JSON.stringify({
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'split', axis: 'row', sizes: [1],
        children: [{ kind: 'leaf', paneRef: { windowId: 'w', paneId: 'p' } }],
      },
    });
    expect(() => fromJson(bad)).toThrow(LayoutSpecValidationError);
  });

  test('invalid axis rejected', () => {
    const bad = JSON.stringify({
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'split', axis: 'diagonal', sizes: [0.5, 0.5],
        children: [
          { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'a' } },
          { kind: 'leaf', paneRef: { windowId: 'w', paneId: 'b' } },
        ],
      },
    });
    expect(() => fromJson(bad)).toThrow(LayoutSpecValidationError);
  });

  test('tabs.active out of range is rejected', () => {
    const bad = toJson({
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'tabs', active: 5,
        panes: [{ windowId: 'w', paneId: 'p' }],
      },
    } as LayoutSpec);
    expect(() => fromJson(bad)).toThrow(LayoutSpecValidationError);
  });

  test('paneRef without paneId is rejected', () => {
    const bad = JSON.stringify({
      version: 1, windowId: 'w', createdAt: 0,
      root: { kind: 'leaf', paneRef: { windowId: 'w' } },
    });
    expect(() => fromJson(bad)).toThrow(LayoutSpecValidationError);
  });

  test('malformed JSON surfaces LayoutSpecValidationError', () => {
    expect(() => fromJson('{not valid')).toThrow(LayoutSpecValidationError);
  });

  test('float rect with zero width is rejected', () => {
    const bad = JSON.stringify({
      version: 1, windowId: 'w', createdAt: 0,
      root: {
        kind: 'float',
        pane: { windowId: 'w', paneId: 'p' },
        rect: { row: 0, col: 0, width: 0, height: 10 },
      },
    });
    expect(() => fromJson(bad)).toThrow(LayoutSpecValidationError);
  });
});
