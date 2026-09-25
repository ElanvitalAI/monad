// ── IUL Phase S·a — SurfaceAddress + SurfaceRegistry tests ──

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  createSurfaceRegistry,
  getSurfaceRegistry,
  __setGlobalSurfaceRegistry,
  surfaceKey,
  sameSurface,
  isSurfaceKind,
  type SurfaceAddress,
  type SurfaceRegistry,
  type SurfaceEvent,
} from '../src/surface/index.js';

const PANE: SurfaceAddress = { kind: 'pane', ref: { windowId: 'w1', paneId: 'p1' } };
const MODAL: SurfaceAddress = { kind: 'modal', modalId: 'mid-abc' };
const WIDGET: SurfaceAddress = { kind: 'widget', widgetId: 'wid-1' };

describe('surface · address helpers', () => {
  test('surfaceKey is stable + collision-free across kinds', () => {
    expect(surfaceKey(PANE)).toBe('pane::w1::p1::');
    expect(surfaceKey(MODAL)).toBe('modal::mid-abc');
    expect(surfaceKey(WIDGET)).toBe('widget::wid-1');
    expect(surfaceKey(PANE)).not.toBe(surfaceKey(MODAL));
  });

  test('surfaceKey includes runnerLabel for pane kind', () => {
    const a: SurfaceAddress = { kind: 'pane', ref: { windowId: 'w', paneId: 'p' } };
    const b: SurfaceAddress = { kind: 'pane', ref: { windowId: 'w', paneId: 'p', runnerLabel: 'shell' } };
    expect(surfaceKey(a)).not.toBe(surfaceKey(b));
  });

  test('sameSurface is true on equal address payloads', () => {
    const a: SurfaceAddress = { kind: 'modal', modalId: 'x' };
    const b: SurfaceAddress = { kind: 'modal', modalId: 'x' };
    expect(sameSurface(a, b)).toBe(true);
  });

  test('isSurfaceKind narrows valid strings + rejects others', () => {
    expect(isSurfaceKind('pane')).toBe(true);
    expect(isSurfaceKind('modal')).toBe(true);
    expect(isSurfaceKind('overlay')).toBe(false);
    expect(isSurfaceKind(42)).toBe(false);
  });
});

describe('surface · registry CRUD', () => {
  let r: SurfaceRegistry;
  beforeEach(() => { r = createSurfaceRegistry(); });

  test('register stamps registeredAt + visible defaults true', () => {
    const d = r.register({ addr: MODAL, kindTag: 'dialog', now: () => 1000 });
    expect(d.visible).toBe(true);
    expect(d.registeredAt).toBe(1000);
    expect(d.kindTag).toBe('dialog');
  });

  test('register accepts explicit visible/tier/title/zHint/stateHash', () => {
    const d = r.register({
      addr: MODAL, kindTag: 'dialog', tier: 'dialog', title: 'Confirm',
      visible: false, zHint: 7, stateHash: 'h1',
    });
    expect(d.visible).toBe(false);
    expect(d.tier).toBe('dialog');
    expect(d.title).toBe('Confirm');
    expect(d.zHint).toBe(7);
    expect(d.stateHash).toBe('h1');
  });

  test('re-register overwrites existing entry', () => {
    r.register({ addr: MODAL, kindTag: 'a' });
    r.register({ addr: MODAL, kindTag: 'b' });
    expect(r.get(MODAL)?.kindTag).toBe('b');
  });

  test('unregister returns true on hit, false on miss', () => {
    r.register({ addr: MODAL, kindTag: 'x' });
    expect(r.unregister(MODAL)).toBe(true);
    expect(r.unregister(MODAL)).toBe(false);
  });

  test('update mutates only specified fields, returns the new descriptor', () => {
    r.register({ addr: MODAL, kindTag: 'x', visible: true, title: 'A' });
    const next = r.update({ addr: MODAL, visible: false, zHint: 3 });
    expect(next?.visible).toBe(false);
    expect(next?.zHint).toBe(3);
    expect(next?.title).toBe('A'); // unchanged
  });

  test('update on unknown returns undefined (no register-as-side-effect)', () => {
    expect(r.update({ addr: MODAL, visible: true })).toBeUndefined();
    expect(r.get(MODAL)).toBeUndefined();
  });
});

describe('surface · registry queries', () => {
  let r: SurfaceRegistry;
  beforeEach(() => { r = createSurfaceRegistry(); });

  test('list returns all entries; listVisible filters', () => {
    r.register({ addr: PANE, kindTag: 'pane', visible: true });
    r.register({ addr: MODAL, kindTag: 'modal', visible: false });
    expect(r.list().length).toBe(2);
    expect(r.listVisible().length).toBe(1);
    expect(r.listVisible()[0]!.addr.kind).toBe('pane');
  });

  test('listByKind partitions by union discriminator', () => {
    r.register({ addr: PANE, kindTag: 'pane' });
    r.register({ addr: MODAL, kindTag: 'modal' });
    r.register({ addr: WIDGET, kindTag: 'widget' });
    expect(r.listByKind('modal').length).toBe(1);
    expect(r.listByKind('widget')[0]!.addr.kind).toBe('widget');
    expect(r.listByKind('popover').length).toBe(0);
  });
});

describe('surface · subscriptions', () => {
  let r: SurfaceRegistry;
  beforeEach(() => { r = createSurfaceRegistry(); });

  test('register/unregister/update each fire their own event kind', () => {
    const events: SurfaceEvent[] = [];
    r.on('register',   e => events.push(e));
    r.on('unregister', e => events.push(e));
    r.on('update',     e => events.push(e));
    r.register({ addr: MODAL, kindTag: 'x' });
    r.update({ addr: MODAL, visible: false });
    r.unregister(MODAL);
    expect(events.map(e => e.kind)).toEqual(['register', 'update', 'unregister']);
  });

  test('subscriber unsubscribe stops further fanout', () => {
    const seen: number[] = [];
    const off = r.on('register', () => seen.push(1));
    r.register({ addr: MODAL, kindTag: 'x' });
    off();
    r.register({ addr: PANE, kindTag: 'p' });
    expect(seen.length).toBe(1);
  });

  test('throwing subscriber does not break further fanout', () => {
    const good: number[] = [];
    r.on('register', () => { throw new Error('boom'); });
    r.on('register', () => good.push(1));
    r.register({ addr: MODAL, kindTag: 'x' });
    expect(good.length).toBe(1);
  });
});

describe('surface · global singleton', () => {
  test('getSurfaceRegistry returns the same instance', () => {
    const a = getSurfaceRegistry();
    const b = getSurfaceRegistry();
    expect(a).toBe(b);
  });

  test('__setGlobalSurfaceRegistry swaps + restores', () => {
    const fresh = createSurfaceRegistry();
    const prev = __setGlobalSurfaceRegistry(fresh);
    try {
      expect(getSurfaceRegistry()).toBe(fresh);
    } finally {
      __setGlobalSurfaceRegistry(prev);
    }
  });
});

describe('surface · reset', () => {
  test('reset clears entries + subscribers', () => {
    const r = createSurfaceRegistry();
    const seen: number[] = [];
    r.on('register', () => seen.push(1));
    r.register({ addr: MODAL, kindTag: 'x' });
    r.reset();
    expect(r.list().length).toBe(0);
    r.register({ addr: PANE, kindTag: 'p' });
    expect(seen).toEqual([1]); // only the pre-reset event
  });
});
