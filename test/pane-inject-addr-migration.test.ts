// ── VW-term-infra Bundle B-12-α — PaneInject addr-first migration tests ──
//
// Covers:
//   1. legacy `pane_addr` path + approver grants → write
//   2. new `target: {kind:'pane', ref}` path + approver grants → write
//   3. target + pane_addr both → legacy wins
//   4. neither supplied → explicit error
//   5. no approver → fail-closed error (unchanged behavior)

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildPaneInjectTool,
  dispatchPaneInject,
  _resetVirtualWindowToolsForTesting,
} from '../src/skills/tools/virtual-windows.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createVWEventBus } from '../src/virtual-windows/event-bus.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

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

afterEach(() => { _resetVirtualWindowToolsForTesting(); });

describe('B-12-α · PaneInject addr-first migration', () => {
  test('tool spec exposes target + legacy pane_addr · bytes required', () => {
    const spec = buildPaneInjectTool();
    expect(spec.name).toBe('PaneInject');
    const props = (spec.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.target).toBeDefined();
    expect(props.pane_addr).toBeDefined();
    expect((spec.parameters as Record<string, unknown>).required).toEqual(['bytes']);
  });

  test('legacy pane_addr path still works with approver grant', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    const grants: Array<{ paneAddr: string; totalBytes: number }> = [];
    await dispatchPaneInject(
      { pane_addr: `pane:${win.focused}`, bytes: 'legacy' },
      { ...h, injectApprover: async (req) => { grants.push(req); return true; } },
    );
    expect(win.getPane(win.focused)?.capture()).toBe('legacy');
    expect(grants).toHaveLength(1);
    expect(grants[0]!.paneAddr).toBe(`pane:${win.focused}`);
  });

  test('new target path writes + approver sees canonical pane:<id> addr', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    const grants: Array<{ paneAddr: string }> = [];
    await dispatchPaneInject(
      {
        target: { kind: 'pane', ref: { windowId: String(win.id), paneId: win.focused } },
        bytes: 'structured',
      },
      { ...h, injectApprover: async (req) => { grants.push(req); return true; } },
    );
    expect(win.getPane(win.focused)?.capture()).toBe('structured');
    expect(grants[0]!.paneAddr).toBe(`pane:${win.focused}`);
  });

  test('target + legacy both → legacy wins', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    await dispatchPaneInject(
      {
        target: { kind: 'pane', ref: { windowId: '999', paneId: 'ghost' } },
        pane_addr: `pane:${win.focused}`,
        bytes: 'legacy-wins',
      },
      { ...h, injectApprover: async () => true },
    );
    expect(win.getPane(win.focused)?.capture()).toBe('legacy-wins');
  });

  test('neither target nor pane_addr → explicit error', async () => {
    const h = harness();
    await expect(
      dispatchPaneInject({ bytes: 'x' }, { ...h, injectApprover: async () => true }),
    ).rejects.toThrow(/provide 'target' or 'pane_addr'/);
  });

  test('target path + no approver → fail-closed (unchanged)', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    await expect(
      dispatchPaneInject(
        {
          target: { kind: 'pane', ref: { windowId: String(win.id), paneId: win.focused } },
          bytes: 'x',
        },
        h,
      ),
    ).rejects.toThrow(/no approver/);
  });
});
