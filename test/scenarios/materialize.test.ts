// ── Presentation P5a · scenario materialization ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { materializeScenario } from '../../src/scenarios/materialize.js';
import {
  _resetWidgetSchemaRegistryForTest,
  registerWidgetSchema,
} from '../../src/ui/declarative/index.js';
import { BoxDecoration } from '../../src/ui/attributes/index.js';

beforeEach(() => {
  _resetWidgetSchemaRegistryForTest();
  registerWidgetSchema({
    type: 'log',
    description: 'log widget',
    configSchema: {
      type: 'object',
      properties: { lines: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
  });
  registerWidgetSchema({
    type: 'list',
    description: 'list widget',
    configSchema: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
  });
});

describe('materializeScenario · basic decode', () => {
  test('layout array → WidgetSpec[]', () => {
    const result = materializeScenario({
      id: 'x',
      title: 'X',
      layout: [{ widget: 'log', config: { lines: ['hi'] } }],
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('log');
    expect(result.widgets[0]?.config).toEqual({ lines: ['hi'] });
  });

  test('empty layout is valid', () => {
    const result = materializeScenario({
      id: 'empty',
      title: 'Empty',
      layout: [],
    });
    expect(result.ok).toBe(true);
    expect(result.widgets).toHaveLength(0);
  });

  test('unknown widget type · permissive fallback (P3 pattern)', () => {
    const result = materializeScenario({
      id: 'unknown',
      title: 'Unknown',
      layout: [{ widget: 'no-such-widget', config: { anything: 'goes' } }],
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('no-such-widget');
  });
});

describe('materializeScenario · shorthand → decoration roundtrip', () => {
  test('border.all + borderRadius.circular + padding:N reach BoxDecoration', () => {
    const result = materializeScenario({
      id: 'deco',
      title: 'Deco',
      layout: [
        {
          widget: 'log',
          style: {
            decoration: {
              color: 'surface',
              border: { all: { color: 'border.focused', width: 1 } },
              borderRadius: { circular: 1 },
              padding: 2,
            },
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    const deco = result.widgets[0]?.decoration;
    expect(deco).toBeInstanceOf(BoxDecoration);
    expect(deco?.color).toBe('surface');
    expect(deco?.borderRadius?.topLeft).toBe(1);
    expect(deco?.borderRadius?.bottomRight).toBe(1);
    expect(deco?.padding?.top).toBe(2);
    expect(deco?.padding?.left).toBe(2);
    expect(deco?.border?.top?.color).toBe('border.focused');
    expect(deco?.border?.left?.width).toBe(1);
  });

  test('padding.symmetric → EdgeInsets', () => {
    const result = materializeScenario({
      id: 'sym',
      title: 'Sym',
      layout: [
        {
          widget: 'log',
          style: {
            decoration: {
              padding: { symmetric: { horizontal: 2, vertical: 1 } },
            },
          },
        },
      ],
    });
    const pad = result.widgets[0]?.decoration?.padding;
    expect(pad?.horizontal).toBe(4);
    expect(pad?.vertical).toBe(2);
  });

  test('boxShadow list passes through', () => {
    const result = materializeScenario({
      id: 'shadow',
      title: 'Shadow',
      layout: [
        {
          widget: 'log',
          style: {
            decoration: {
              boxShadow: [
                { offset: { dx: 1, dy: 1 }, color: 'border', opacity: 0.4 },
              ],
            },
          },
        },
      ],
    });
    const shadows = result.widgets[0]?.decoration?.boxShadow;
    expect(shadows).toHaveLength(1);
    expect(shadows?.[0]?.offset).toEqual({ dx: 1, dy: 1 });
    expect(shadows?.[0]?.color).toBe('border');
    expect(shadows?.[0]?.opacity).toBeCloseTo(0.4);
  });
});

describe('materializeScenario · validation errors', () => {
  test('invalid widget config rejected in strict mode (default)', () => {
    const result = materializeScenario({
      id: 'bad',
      title: 'Bad',
      layout: [{ widget: 'log', config: { lines: [], unexpected: 'field' } }],
    });
    expect(result.ok).toBe(false);
    expect(result.widgets).toHaveLength(0);
  });

  test('lax mode returns partial tree + errors', () => {
    const result = materializeScenario(
      {
        id: 'lax',
        title: 'Lax',
        layout: [{ widget: 'log', config: { lines: [], unexpected: 'field' } }],
      },
      { lax: true },
    );
    expect(result.ok).toBe(false);
    expect(result.widgets).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
