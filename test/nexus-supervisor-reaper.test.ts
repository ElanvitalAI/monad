// NEXUS · supervisor orphan reaper tests (Phase N-2 PR ε)

import { describe, test, expect } from 'bun:test';
import { reclaimOrphans } from '../src/nexus/supervisor/reaper.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { createNexusState } from '../src/nexus/state/state.js';

function setup() {
  const state = createNexusState({ nexusVersion: '0.5.0', phase: 'test' });
  const registry = new TabRegistry(state);
  return { state, registry };
}

describe('reclaimOrphans · alive child', () => {
  test('alive pid → status=active + nexus.boot{reclaimed:true}', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { pid: 12345, status: 'stopped' });
    const out = reclaimOrphans({ state, registry, isAlive: () => true });
    expect(out).toEqual([{ tabId: 'd', outcome: 'reclaimed', pid: 12345 }]);
    expect(registry.get('d')!.status).toBe('active');
    expect(registry.get('d')!.pid).toBe(12345);
    const ev = state.events.find((e) => e.kind === 'nexus.boot' && e.tabId === 'd');
    expect(ev).toBeDefined();
    expect(ev?.detail).toEqual({ reclaimed: true, pid: 12345 });
  });
});

describe('reclaimOrphans · dead child', () => {
  test('dead pid → pid cleared + status=stopped + tab.down event', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { pid: 12345, status: 'active' });
    const out = reclaimOrphans({ state, registry, isAlive: () => false });
    expect(out).toEqual([{ tabId: 'd', outcome: 'stopped', pid: 12345 }]);
    expect(registry.get('d')!.pid).toBeUndefined();
    expect(registry.get('d')!.status).toBe('stopped');
    expect(state.events.find((e) => e.kind === 'tab.down' && e.tabId === 'd')).toMatchObject({
      detail: { reason: 'orphan-dead', pid: 12345 },
    });
  });
});

describe('reclaimOrphans · no pid', () => {
  test('tab with no pid → outcome=no-pid, no events', () => {
    const { state, registry } = setup();
    registry.register({ id: 'c', kind: 'chat', label: 'c' });
    const baselineEvents = state.events.length;
    const out = reclaimOrphans({ state, registry, isAlive: () => true });
    expect(out).toEqual([{ tabId: 'c', outcome: 'no-pid' }]);
    expect(state.events.length).toBe(baselineEvents);
  });
});

describe('reclaimOrphans · multiple tabs', () => {
  test('mixed alive/dead/no-pid handled correctly', () => {
    const { state, registry } = setup();
    registry.register({ id: 'a', kind: 'daemon', label: 'a' });
    registry.register({ id: 'b', kind: 'daemon', label: 'b' });
    registry.register({ id: 'c', kind: 'chat', label: 'c' });
    registry.patch('a', { pid: 100 });
    registry.patch('b', { pid: 200 });
    const aliveSet = new Set([100]);
    const out = reclaimOrphans({ state, registry, isAlive: (pid) => aliveSet.has(pid) });
    expect(out).toEqual([
      { tabId: 'a', outcome: 'reclaimed', pid: 100 },
      { tabId: 'b', outcome: 'stopped', pid: 200 },
      { tabId: 'c', outcome: 'no-pid' },
    ]);
  });
});

describe('reclaimOrphans · default isAlive', () => {
  test('uses process.kill(0) probe when isAlive omitted', () => {
    // process.pid is always alive, very large pid is virtually never alive.
    const { state, registry } = setup();
    registry.register({ id: 'self', kind: 'daemon', label: 'self' });
    registry.register({ id: 'gone', kind: 'daemon', label: 'gone' });
    registry.patch('self', { pid: process.pid });
    registry.patch('gone', { pid: 2_147_483_640 });
    const out = reclaimOrphans({ state, registry });
    const selfOut = out.find((o) => o.tabId === 'self');
    const goneOut = out.find((o) => o.tabId === 'gone');
    expect(selfOut?.outcome).toBe('reclaimed');
    expect(goneOut?.outcome).toBe('stopped');
  });
});
