// ── Presentation P5a · decoration shorthand expansion ──

import { describe, test, expect } from 'bun:test';
import {
  expandDecorationShorthand,
  expandScenarioShorthand,
} from '../../src/scenarios/shorthand.js';

describe('expandDecorationShorthand · border', () => {
  test('border.all → top/right/bottom/left', () => {
    const out = expandDecorationShorthand({
      border: { all: { color: 'text', width: 1 } },
    }) as { border: Record<string, unknown> };
    expect(out.border.top).toEqual({ color: 'text', width: 1 });
    expect(out.border.right).toEqual({ color: 'text', width: 1 });
    expect(out.border.bottom).toEqual({ color: 'text', width: 1 });
    expect(out.border.left).toEqual({ color: 'text', width: 1 });
  });

  test('border.symmetric · horizontal + vertical', () => {
    const out = expandDecorationShorthand({
      border: {
        symmetric: {
          horizontal: { color: 'a', width: 1 },
          vertical: { color: 'b', width: 2 },
        },
      },
    }) as { border: Record<string, unknown> };
    expect(out.border.top).toEqual({ color: 'b', width: 2 });
    expect(out.border.bottom).toEqual({ color: 'b', width: 2 });
    expect(out.border.left).toEqual({ color: 'a', width: 1 });
    expect(out.border.right).toEqual({ color: 'a', width: 1 });
  });

  test('border.only · nested keys passthrough', () => {
    const out = expandDecorationShorthand({
      border: { only: { top: { color: 'x' } } },
    }) as { border: Record<string, unknown> };
    expect(out.border.top).toEqual({ color: 'x' });
    expect(out.border.right).toBeUndefined();
  });

  test('explicit top/right/bottom/left · left untouched', () => {
    const raw = {
      border: { top: { color: 'a' }, bottom: { color: 'b' } },
    };
    const out = expandDecorationShorthand(raw) as { border: Record<string, unknown> };
    expect(out.border.top).toEqual({ color: 'a' });
    expect(out.border.bottom).toEqual({ color: 'b' });
  });
});

describe('expandDecorationShorthand · borderRadius', () => {
  test('borderRadius.circular → 4 corners', () => {
    const out = expandDecorationShorthand({
      borderRadius: { circular: 2 },
    }) as { borderRadius: Record<string, unknown> };
    expect(out.borderRadius.topLeft).toBe(2);
    expect(out.borderRadius.topRight).toBe(2);
    expect(out.borderRadius.bottomLeft).toBe(2);
    expect(out.borderRadius.bottomRight).toBe(2);
  });

  test('borderRadius.only passthrough', () => {
    const out = expandDecorationShorthand({
      borderRadius: { only: { topLeft: 3 } },
    }) as { borderRadius: Record<string, unknown> };
    expect(out.borderRadius.topLeft).toBe(3);
  });
});

describe('expandDecorationShorthand · padding', () => {
  test('scalar `padding: 2` → all 4 sides', () => {
    const out = expandDecorationShorthand({ padding: 2 }) as {
      padding: Record<string, unknown>;
    };
    expect(out.padding.top).toBe(2);
    expect(out.padding.right).toBe(2);
    expect(out.padding.bottom).toBe(2);
    expect(out.padding.left).toBe(2);
  });

  test('padding.all (object form)', () => {
    const out = expandDecorationShorthand({ padding: { all: 3 } }) as {
      padding: Record<string, unknown>;
    };
    expect(out.padding.top).toBe(3);
  });

  test('padding.symmetric', () => {
    const out = expandDecorationShorthand({
      padding: { symmetric: { horizontal: 2, vertical: 1 } },
    }) as { padding: Record<string, unknown> };
    expect(out.padding.left).toBe(2);
    expect(out.padding.right).toBe(2);
    expect(out.padding.top).toBe(1);
    expect(out.padding.bottom).toBe(1);
  });

  test('padding.only passthrough', () => {
    const out = expandDecorationShorthand({
      padding: { only: { top: 1, bottom: 2 } },
    }) as { padding: Record<string, unknown> };
    expect(out.padding.top).toBe(1);
    expect(out.padding.bottom).toBe(2);
  });
});

describe('expandScenarioShorthand · tree walk', () => {
  test('layout array → each node expanded', () => {
    const tree = {
      layout: [
        {
          widget: 'log',
          style: { decoration: { border: { all: { color: 'text' } } } },
        },
        {
          widget: 'list',
          style: { decoration: { padding: 2 } },
        },
      ],
    };
    const out = expandScenarioShorthand(tree) as typeof tree;
    const log = out.layout[0] as { style: { decoration: { border: Record<string, unknown> } } };
    const list = out.layout[1] as { style: { decoration: { padding: Record<string, unknown> } } };
    expect(log.style.decoration.border.top).toEqual({ color: 'text' });
    expect(list.style.decoration.padding).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
  });

  test('nested children recursively expanded', () => {
    const tree = {
      widget: 'container',
      children: [
        {
          widget: 'log',
          style: { decoration: { borderRadius: { circular: 2 } } },
        },
      ],
    };
    const out = expandScenarioShorthand(tree) as {
      children: Array<{ style: { decoration: { borderRadius: Record<string, unknown> } } }>;
    };
    expect(out.children[0]!.style.decoration.borderRadius.topLeft).toBe(2);
  });

  test('tree without style untouched', () => {
    const tree = { widget: 'log', config: { lines: ['a'] } };
    const out = expandScenarioShorthand(tree);
    expect(out).toEqual(tree);
  });

  test('non-object input passthrough', () => {
    expect(expandScenarioShorthand(42 as unknown)).toBe(42 as unknown);
    expect(expandScenarioShorthand(null as unknown)).toBe(null as unknown);
  });
});
