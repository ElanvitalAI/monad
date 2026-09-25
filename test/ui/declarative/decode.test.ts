// ── Presentation P3 · decodeWidgetTree + encodeWidgetTree ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  decodeWidgetTree,
  decodeWidgetTreeYAML,
} from '../../../src/ui/declarative/decode.js';
import { encodeWidgetTree } from '../../../src/ui/declarative/encode.js';
import { listWidget, logWidget } from '../../../src/ui/declarative/builder.js';
import {
  registerWidgetSchema,
  _resetWidgetSchemaRegistryForTest,
} from '../../../src/ui/declarative/schema.js';
import { BoxDecoration } from '../../../src/ui/attributes/index.js';

beforeEach(() => {
  _resetWidgetSchemaRegistryForTest();
  registerWidgetSchema({
    type: 'log',
    description: 'log',
    configSchema: {
      type: 'object',
      properties: { lines: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
  });
  registerWidgetSchema({
    type: 'list',
    description: 'list',
    configSchema: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
  });
});

describe('decodeWidgetTree · basic shapes', () => {
  test('single widget object', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      config: { lines: ['hi'] },
    });
    expect(result.ok).toBe(true);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0]?.type).toBe('log');
    expect(result.widgets[0]?.config).toEqual({ lines: ['hi'] });
  });

  test('top-level array', () => {
    const result = decodeWidgetTree([
      { widget: 'log', config: { lines: ['a'] } },
      { widget: 'list', config: { items: ['1', '2'] } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.widgets.map((w) => w.type)).toEqual(['log', 'list']);
  });

  test('layout wrapper', () => {
    const result = decodeWidgetTree({
      layout: [{ widget: 'log', config: { lines: [] } }],
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('log');
  });

  test('widgets wrapper variant', () => {
    const result = decodeWidgetTree({
      widgets: [{ widget: 'log' }],
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('log');
  });

  test('top-level preset expands into the lab preset widgets', () => {
    const result = decodeWidgetTree({ preset: 'telemetry-stack' });
    expect(result.ok).toBe(true);
    expect(result.widgets).toHaveLength(2);
    expect(result.widgets[0]?.chrome?.title).toBe('Telemetry');
    expect(result.widgets[1]?.chrome?.title).toBe('Queue');
  });

  test('single-widget wrapper preset expands cleanly', () => {
    const result = decodeWidgetTree({ preset: 'ask-user-flow' });
    expect(result.ok).toBe(true);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0]?.type).toBe('request-user-input-overlay');
    expect(result.widgets[0]?.chrome?.title).toBe('Ask user');
  });

  test('type field accepted as alias for widget', () => {
    const result = decodeWidgetTree({ type: 'log' });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('log');
  });

  test('id passthrough', () => {
    const result = decodeWidgetTree({ widget: 'log', id: 'log-1' });
    expect(result.widgets[0]?.id).toBe('log-1');
  });

  test('character passthrough', () => {
    const result = decodeWidgetTree({ widget: 'log', character: 'System Log' });
    expect(result.widgets[0]?.character).toBe('System Log');
  });

  test('node-level preset hydrates a single widget and allows overrides', () => {
    const result = decodeWidgetTree({
      preset: 'approval-dialog',
      id: 'approval-2',
      config: { body: 'Ship now?' },
      chrome: { footer: 'Enter approve' },
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('dialog');
    expect(result.widgets[0]?.id).toBe('approval-2');
    expect(result.widgets[0]?.config).toMatchObject({ body: 'Ship now?' });
    expect(result.widgets[0]?.chrome?.title).toBe('Approve patch?');
    expect(result.widgets[0]?.chrome?.footer).toBe('Enter approve');
  });
});

describe('decodeWidgetTree · validation + errors', () => {
  test('missing widget field → error', () => {
    // Node inside an explicit layout wrapper so collectRoots accepts it —
    // this targets the per-node `missing widget/type` path.
    const result = decodeWidgetTree({ layout: [{ config: {} }] });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain('missing');
  });

  test('unrecognizable root shape → error', () => {
    const result = decodeWidgetTree({ random: 'stuff' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain('layout/widgets');
  });

  test('unknown preset is rejected', () => {
    const result = decodeWidgetTree({ preset: 'missing-lab' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toBe('$.preset');
  });

  test('multi-widget preset is rejected at node level', () => {
    const result = decodeWidgetTree({ widget: 'log', preset: 'telemetry-stack' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toBe('$[0].preset');
  });

  test('unknown widget type uses permissive fallback · ok with any config', () => {
    const result = decodeWidgetTree({
      widget: 'unknown-type',
      config: { anything: 'goes' },
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('unknown-type');
  });

  test('built-in declarative view wrappers validate with explicit schemas', () => {
    const result = decodeWidgetTree({
      widget: 'permission-prompt',
      config: {
        title: 'Approve?',
        choices: 'not-an-array',
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toContain('config.choices');
  });

  test('config with unknown property rejected (strict schema)', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      config: { lines: [], unexpected: 1 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toContain('config');
    expect(result.errors[0]?.path).toContain('unexpected');
  });

  test('lax mode returns partial tree despite errors', () => {
    const result = decodeWidgetTree(
      {
        widget: 'log',
        config: { lines: [], badField: 1 },
      },
      { lax: true },
    );
    expect(result.ok).toBe(false);
    expect(result.widgets).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('strict mode (default) drops tree on first error', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      config: { lines: [], badField: 1 },
    });
    expect(result.ok).toBe(false);
    expect(result.widgets).toHaveLength(0);
  });
});

describe('decodeWidgetTree · nested children', () => {
  test('children recursively decoded', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      children: [{ widget: 'list' }, { widget: 'log' }],
    });
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.children).toHaveLength(2);
    expect(result.widgets[0]?.children?.[0]?.type).toBe('list');
  });

  test('child validation error surfaces with nested path', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      children: [{ widget: 'list', config: { badField: 1 } }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toContain('children[0]');
  });
});

describe('decodeWidgetTree · style.decoration', () => {
  test('style.decoration parsed into BoxDecoration instance', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      style: {
        decoration: {
          color: 'surface',
          shape: 'rectangle',
        },
      },
    });
    expect(result.ok).toBe(true);
    const spec = result.widgets[0];
    expect(spec?.decoration).toBeInstanceOf(BoxDecoration);
    expect(spec?.decoration?.color).toBe('surface');
  });

  test('style/chrome/motion/interactions parse into extended spec', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      character: 'Telemetry',
      style: {
        className: 'card',
        variant: 'raised',
        decoration: { color: 'surface' },
        states: {
          hovered: { className: 'card-hover' },
        },
      },
      chrome: {
        variant: 'window',
        title: 'Telemetry',
        footer: 'Ctrl+P preview',
      },
      motion: {
        preset: 'fade',
        durationMs: 180,
        hover: { preset: 'pulse', durationMs: 90 },
      },
      interactions: {
        hover: { action: 'show-tooltip', payload: { id: 'telemetry' } },
        click: [{ action: 'open-widget' }],
        key: [{ key: 'enter', action: 'open-widget' }],
      },
    });
    expect(result.ok).toBe(true);
    const spec = result.widgets[0];
    expect(spec?.character).toBe('Telemetry');
    expect(spec?.style?.className).toBe('card');
    expect(spec?.style?.states?.hovered?.className).toBe('card-hover');
    expect(spec?.chrome?.variant).toBe('window');
    expect(spec?.motion?.hover?.preset).toBe('pulse');
    expect(spec?.interactions?.key?.[0]?.key).toBe('enter');
  });
});

describe('decodeWidgetTree · extended validation', () => {
  test('invalid motion preset is rejected', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      motion: { preset: 'warp-drive' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toContain('motion');
  });

  test('invalid interaction handler shape is rejected', () => {
    const result = decodeWidgetTree({
      widget: 'log',
      interactions: {
        click: { payload: { x: 1 } },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toContain('interactions');
  });
});

describe('encodeWidgetTree · round-trip', () => {
  test('decode → encode → decode yields equivalent specs', () => {
    const original = {
      layout: [
        {
          widget: 'log',
          id: 'log-1',
          character: 'System Log',
          config: { lines: ['a', 'b'] },
          chrome: { title: 'System Log', variant: 'panel' },
        },
        {
          widget: 'list',
          config: { items: ['x', 'y'] },
          motion: { preset: 'fade', durationMs: 120 },
        },
      ],
    };
    const decoded1 = decodeWidgetTree(original);
    expect(decoded1.ok).toBe(true);

    const encoded = encodeWidgetTree(decoded1.widgets);
    const decoded2 = decodeWidgetTree(encoded);
    expect(decoded2.ok).toBe(true);
    expect(decoded2.widgets.map((w) => w.type)).toEqual(['log', 'list']);
    expect(decoded2.widgets[0]?.id).toBe('log-1');
    expect(decoded2.widgets[0]?.character).toBe('System Log');
    expect(decoded2.widgets[0]?.config).toEqual({ lines: ['a', 'b'] });
    expect(decoded2.widgets[0]?.chrome?.title).toBe('System Log');
    expect(decoded2.widgets[1]?.motion?.preset).toBe('fade');
  });

  test('decoration round-trip · nested attribute reconstruction', () => {
    const decoded = decodeWidgetTree({
      widget: 'log',
      style: { decoration: { color: 'fg', shape: 'circle' } },
    });
    const encoded = encodeWidgetTree(decoded.widgets);
    const node = encoded.layout[0];
    expect(node?.style?.decoration.color).toBe('fg');
    expect(node?.style?.decoration.shape).toBe('circle');
  });

  test('extended spec round-trip preserves chrome/motion/interactions', () => {
    const decoded = decodeWidgetTree({
      widget: 'log',
      character: 'Audit',
      chrome: { title: 'Audit', titleAlign: 'center' },
      motion: { preset: 'fade', durationMs: 160 },
      interactions: { click: { action: 'open-audit' } },
    });
    const encoded = encodeWidgetTree(decoded.widgets);
    const node = encoded.layout[0];
    expect(node?.character).toBe('Audit');
    expect(node?.chrome?.titleAlign).toBe('center');
    expect(node?.motion?.preset).toBe('fade');
    expect((node?.interactions?.click as { action: string }).action).toBe('open-audit');
  });

  test('builder-authored nodes encode without pre-building specs', () => {
    const encoded = encodeWidgetTree([
      logWidget('Telemetry').setLines(['a', 'b']),
      listWidget('Queue').setItems(['x', 'y']),
    ]);
    expect(encoded.layout).toHaveLength(2);
    expect(encoded.layout[0]).toMatchObject({
      widget: 'log',
      chrome: { title: 'Telemetry' },
      config: { lines: ['a', 'b'] },
    });
    expect(encoded.layout[1]).toMatchObject({
      widget: 'list',
      chrome: { title: 'Queue' },
      config: { items: ['x', 'y'] },
    });
  });
});

describe('decodeWidgetTreeYAML · yaml dep', () => {
  test('parses YAML input through shared decoder', async () => {
    const yaml = `
layout:
  - widget: log
    config:
      lines:
        - hello
`;
    const result = await decodeWidgetTreeYAML(yaml);
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.type).toBe('log');
    expect((result.widgets[0]?.config as { lines: string[] }).lines).toEqual(['hello']);
  });

  test('parses top-level preset YAML through shared decoder', async () => {
    const result = await decodeWidgetTreeYAML('preset: approval-dialog\n');
    expect(result.ok).toBe(true);
    expect(result.widgets[0]?.chrome?.title).toBe('Approve patch?');
  });
});
