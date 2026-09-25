// ── VW-term-infra Bundle B-11-α — PaneCapture addr-first migration tests ──
//
// Covers:
//   1. legacy `pane_addr: "pane:<id>"` → capture succeeds
//   2. new  `target: {kind:'pane', ref:{paneId}}` → capture succeeds
//   3. target path produces the same body as the legacy path (parity)
//   4. target + pane_addr both supplied → legacy `pane_addr` wins
//   5. neither supplied → explicit error
//
// These tests also verify the tool spec shape exposes `target` + still
// accepts `pane_addr`, matching the Screenshot / DescribeSurface pattern.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildPaneCaptureTool,
  dispatchPaneCapture,
  _resetVirtualWindowToolsForTesting,
} from '../src/skills/tools/virtual-windows.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createVWEventBus } from '../src/virtual-windows/event-bus.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { registerPaneContentLookup } from '../src/virtual-windows/pane-capture.js';

function harness() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const registry = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  const bus = createVWEventBus({ addressBook: book, writePane: () => {} });
  return { coord, book, registry, bus, addressBook: book, eventBus: bus };
}

afterEach(() => {
  _resetVirtualWindowToolsForTesting();
  registerPaneContentLookup(() => null);
});

describe('B-11-α · PaneCapture addr-first migration', () => {
  test('tool spec exposes target + legacy pane_addr', () => {
    const spec = buildPaneCaptureTool();
    expect(spec.name).toBe('PaneCapture');
    const props = (spec.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.target).toBeDefined();
    expect(props.pane_addr).toBeDefined();
    // Neither required at schema level — dispatcher decides.
    expect((spec.parameters as Record<string, unknown>).required).toBeUndefined();
  });

  test('legacy pane_addr path still works', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'LEGACY' } });
    registerPaneContentLookup((id) => {
      const p = win.getPane(id);
      return p ? { capture: () => p.capture() } : null;
    });
    const r = await dispatchPaneCapture({ pane_addr: `pane:${win.focused}`, mode: 'text' }, h);
    expect(r.output).toContain('LEGACY');
  });

  test('new target: {kind:"pane", ref:{paneId}} path succeeds', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'STRUCTURED' } });
    registerPaneContentLookup((id) => {
      const p = win.getPane(id);
      return p ? { capture: () => p.capture() } : null;
    });
    const r = await dispatchPaneCapture(
      { target: { kind: 'pane', ref: { windowId: String(win.id), paneId: win.focused } }, mode: 'text' },
      h,
    );
    expect(r.output).toContain('STRUCTURED');
  });

  test('target and legacy paths produce the same body (parity)', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'PARITY' } });
    registerPaneContentLookup((id) => {
      const p = win.getPane(id);
      return p ? { capture: () => p.capture() } : null;
    });
    const viaLegacy = await dispatchPaneCapture({ pane_addr: `pane:${win.focused}`, mode: 'text' }, h);
    const viaTarget = await dispatchPaneCapture(
      { target: { kind: 'pane', ref: { windowId: String(win.id), paneId: win.focused } }, mode: 'text' },
      h,
    );
    // Output header includes the same `PaneCapture pane:<id>` prefix and
    // the body (after the newline) is identical.
    const bodyLegacy = viaLegacy.output.split('\n').slice(1).join('\n');
    const bodyTarget = viaTarget.output.split('\n').slice(1).join('\n');
    expect(bodyTarget).toBe(bodyLegacy);
    expect(bodyTarget).toContain('PARITY');
  });

  test('when both are supplied, legacy pane_addr wins (explicit intent)', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'LEGACY-WINS' } });
    registerPaneContentLookup((id) => {
      const p = win.getPane(id);
      return p ? { capture: () => p.capture() } : null;
    });
    // `target` points at a non-existent pane id; `pane_addr` points at the
    // real focused pane. Expect the real body — i.e. legacy wins.
    const r = await dispatchPaneCapture(
      {
        target: { kind: 'pane', ref: { windowId: '999', paneId: 'nonexistent' } },
        pane_addr: `pane:${win.focused}`,
        mode: 'text',
      },
      h,
    );
    expect(r.output).toContain('LEGACY-WINS');
  });

  test('neither target nor pane_addr → explicit error', async () => {
    const h = harness();
    await expect(dispatchPaneCapture({ mode: 'text' }, h)).rejects.toThrow(
      /provide 'target' or 'pane_addr'/,
    );
  });
});
