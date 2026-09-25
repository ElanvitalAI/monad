// ── VW-term-infra Bundle B-12-α — BroadcastPanes addr-first migration tests ──
//
// Covers:
//   1. legacy string[] path → bus.broadcast sent count
//   2. mixed (string + SurfaceAddress) array → all resolved
//   3. all SurfaceAddress objects → all resolved
//   4. invalid element (e.g. {kind:'modal'}) → explicit error
//   5. approver reject → propagated

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildBroadcastTool,
  dispatchBroadcast,
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

describe('B-12-α · BroadcastPanes addr-first migration', () => {
  test('tool spec items accept oneOf string | pane-address', () => {
    const spec = buildBroadcastTool();
    const props = (spec.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    const targets = props.targets as { type: string; items: unknown };
    expect(targets.type).toBe('array');
    expect(targets.items).toBeDefined();
    expect(JSON.stringify(targets.items)).toContain('pane');
  });

  test('legacy string targets[] path works', async () => {
    const h = harness();
    const writes: Array<[string, string]> = [];
    const bus = createVWEventBus({ addressBook: h.book, writePane: (id, b) => writes.push([id, b]) });
    const w1 = h.registry.spawn({ title: 'a', initialContent: { kind: 'scratch' } });
    const w2 = h.registry.spawn({ title: 'b', initialContent: { kind: 'scratch' } });
    const r = await dispatchBroadcast(
      { targets: [`pane:${w1.focused}`, `pane:${w2.focused}`], bytes: 'hi' },
      { ...h, eventBus: bus, broadcastApprover: async () => true },
    );
    expect(r.output).toMatch(/sent=2\/2/);
    expect(writes).toHaveLength(2);
    expect(writes.map(w => w[1])).toEqual(['hi', 'hi']);
  });

  test('mixed (string + SurfaceAddress) array resolves both', async () => {
    const h = harness();
    const writes: Array<[string, string]> = [];
    const bus = createVWEventBus({ addressBook: h.book, writePane: (id, b) => writes.push([id, b]) });
    const w1 = h.registry.spawn({ title: 'a', initialContent: { kind: 'scratch' } });
    const w2 = h.registry.spawn({ title: 'b', initialContent: { kind: 'scratch' } });
    const r = await dispatchBroadcast(
      {
        targets: [
          `pane:${w1.focused}`,
          { kind: 'pane', ref: { windowId: String(w2.id), paneId: w2.focused } },
        ],
        bytes: 'mix',
      },
      { ...h, eventBus: bus, broadcastApprover: async () => true },
    );
    expect(r.output).toMatch(/sent=2\/2/);
    expect(writes).toHaveLength(2);
    expect(new Set(writes.map(w => w[0]))).toEqual(new Set([w1.focused, w2.focused]));
  });

  test('all SurfaceAddress objects resolve', async () => {
    const h = harness();
    const writes: Array<[string, string]> = [];
    const bus = createVWEventBus({ addressBook: h.book, writePane: (id, b) => writes.push([id, b]) });
    const w1 = h.registry.spawn({ title: 'a', initialContent: { kind: 'scratch' } });
    const w2 = h.registry.spawn({ title: 'b', initialContent: { kind: 'scratch' } });
    const r = await dispatchBroadcast(
      {
        targets: [
          { kind: 'pane', ref: { windowId: String(w1.id), paneId: w1.focused } },
          { kind: 'pane', ref: { windowId: String(w2.id), paneId: w2.focused } },
        ],
        bytes: 'all-struct',
      },
      { ...h, eventBus: bus, broadcastApprover: async () => true },
    );
    expect(r.output).toMatch(/sent=2\/2/);
    expect(writes).toHaveLength(2);
    expect(writes.every(w => w[1] === 'all-struct')).toBe(true);
  });

  test('invalid element (wrong kind) → explicit error', async () => {
    const h = harness();
    await expect(
      dispatchBroadcast(
        {
          targets: ['pane:x', { kind: 'modal', modalId: 'm1' }],
          bytes: 'x',
        },
        { ...h, broadcastApprover: async () => true },
      ),
    ).rejects.toThrow(/invalid target/);
  });

  test('approver reject → error propagated', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    await expect(
      dispatchBroadcast(
        { targets: [`pane:${win.focused}`], bytes: 'x' },
        { ...h, broadcastApprover: async () => false },
      ),
    ).rejects.toThrow(/rejected/);
  });
});
