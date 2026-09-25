// ── Bundle 6T Phase 3 — Screenshot SurfaceAddress integration tests ──

import { describe, expect, test } from 'bun:test';
import {
  dispatchScreenshot,
  buildScreenshotTool,
} from '../src/capture/capture-tools.js';
import { createSurfaceRegistry } from '../src/surface/index.js';
import {
  createModalIdentityRegistry,
} from '../src/display/modal-identity.js';
import type { DisplaySurfaceResolver, WidgetRenderHost } from '../src/capture/index.js';

function fakeResolver(map: Record<string, string>): DisplaySurfaceResolver {
  return {
    getSurface(id) {
      const ansi = map[id];
      return ansi !== undefined ? { paint: () => ansi } : undefined;
    },
  };
}

function fakeWidgetHost(inst: {
  id: string; type: string; character: string; state: unknown;
  render?: (state: unknown, ctx: unknown, char: string) => string[];
}): WidgetRenderHost {
  return {
    get: (id) => id === inst.id
      ? { id: inst.id, type: inst.type, character: inst.character, state: inst.state }
      : null,
    defFor: (id) => id === inst.id
      ? {
          type: inst.type, description: '',
          render: inst.render ?? (() => ['widget ansi']),
        } as never
      : null,
    buildContext: (id) => id === inst.id ? ({ theme: {} } as never) : null,
    listInstanceIds: () => [inst.id],
  };
}

describe('Screenshot · LLMToolSpec advertisement', () => {
  test('tool spec lists target parameter + legacy windowId/paneId', () => {
    const spec = buildScreenshotTool();
    const props = (spec.parameters as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('target');
    expect(props).toHaveProperty('windowId');
    expect(props).toHaveProperty('paneId');
    expect(props).toHaveProperty('format');
  });

  test('target enum includes all 7 surface kinds + screen', () => {
    const spec = buildScreenshotTool();
    const targetEnum = (spec.parameters as {
      properties: { target: { properties: { kind: { enum: string[] } } } };
    }).properties.target.properties.kind.enum;
    // B-13-α added `window` kind to SurfaceAddress; the screenshot
    // advertisement must match the registry's kind union.
    expect(targetEnum).toEqual([
      'pane', 'modal', 'widget', 'popover', 'inline', 'bg', 'window', 'screen',
    ]);
  });
});

describe('Screenshot · target:modal', () => {
  test('resolves via modal-source → ansi format', async () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'dialog', surfaceId: 'dlg-1' });
    identity.notifyPush(id, 'dlg-1');
    const out = await dispatchScreenshot(
      { target: { kind: 'modal', modalId: id.modalId }, format: 'ansi' },
      { identity, surfaceResolver: fakeResolver({ 'dlg-1': 'dialog body' }) },
    );
    expect(out.format).toBe('ansi');
    expect(out.body).toContain('dialog body');
    expect(out.target).toMatchObject({ kind: 'modal', modalId: id.modalId });
  });

  test('unknown modalId returns note', async () => {
    const out = await dispatchScreenshot(
      { target: { kind: 'modal', modalId: 'ghost' }, format: 'text' },
      {},
    );
    expect(out.note).toMatch(/modal not found/);
    expect(out.bytes).toBe(0);
  });
});

describe('Screenshot · target:widget', () => {
  test('resolves via widget-source', async () => {
    const host = fakeWidgetHost({
      id: 'spark-1', type: 'sparkline', character: 'S', state: { n: 42 },
      render: (s) => [`sparkline n=${(s as { n: number }).n}`],
    });
    const out = await dispatchScreenshot(
      { target: { kind: 'widget', widgetId: 'spark-1' }, format: 'text' },
      { widgetHost: host },
    );
    expect(out.format).toBe('text');
    expect(out.body).toContain('sparkline n=42');
  });

  test('unknown widgetId returns note', async () => {
    const out = await dispatchScreenshot(
      { target: { kind: 'widget', widgetId: 'ghost' }, format: 'text' },
      { widgetHost: fakeWidgetHost({ id: 'x', type: 'y', character: 'X', state: {} }) },
    );
    expect(out.note).toMatch(/widget source unavailable/);
  });
});

describe('Screenshot · target:screen composite', () => {
  test('returns ordered composite dump', async () => {
    const reg = createSurfaceRegistry();
    const identity = createModalIdentityRegistry();
    const mid = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(mid, 's1');
    reg.register({
      addr: { kind: 'modal', modalId: mid.modalId },
      kindTag: 'dialog', tier: 'modal',
    });
    const out = await dispatchScreenshot(
      { target: { kind: 'screen' }, format: 'ansi' },
      { registry: reg, identity, surfaceResolver: fakeResolver({ s1: 'M-ANSI' }) },
    );
    expect(out.format).toBe('ansi');
    expect(out.body).toContain('modal:');
    expect(out.body).toContain('M-ANSI');
  });

  test('empty screen → "no visible surfaces" marker', async () => {
    const reg = createSurfaceRegistry();
    const out = await dispatchScreenshot(
      { target: { kind: 'screen' }, format: 'text' },
      { registry: reg },
    );
    expect(out.body).toContain('no visible surfaces');
  });
});

describe('Screenshot · legacy backward compat', () => {
  test('{windowId, paneId} still works (throws on unknown pane)', async () => {
    // No factory → pane resolution throws; we just ensure the parser
    // doesn't reject the legacy shape.
    const out = await dispatchScreenshot(
      { windowId: 'w1', paneId: 'nonexistent', format: 'text' },
      {},
    );
    expect(out.note).toMatch(/pane not found/);
  });

  test('neither target nor windowId → error', async () => {
    await expect(dispatchScreenshot({ format: 'text' }, {}))
      .rejects.toThrow(/target or \(windowId, paneId\)/);
  });

  test('target:pane with ref uses new SurfaceAddress path', async () => {
    const out = await dispatchScreenshot(
      {
        target: { kind: 'pane', ref: { windowId: 'w', paneId: 'p' } },
        format: 'text',
      },
      {},
    );
    // Pane factory lookup fails in isolated test → note returned
    expect(out.note).toMatch(/pane not found/);
  });
});
