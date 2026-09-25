// ── IUL Phase M — modal-identity registry tests ──
//
// Validates allocate / get / promote / release / push-pop notification
// + subscription semantics. The registry stays passive — coordinator
// wiring is exercised separately in dashboard integration tests.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  createModalIdentityRegistry,
  getModalIdentityRegistry,
  __setGlobalModalIdentityRegistry,
  type ModalIdentityRegistry,
  type ModalLifecycleEvent,
  type ModalPromoteEvent,
} from '../src/display/modal-identity.js';

describe('modal-identity · allocation', () => {
  let r: ModalIdentityRegistry;
  beforeEach(() => { r = createModalIdentityRegistry(); });

  test('allocate produces unique modalId per call', () => {
    const a = r.allocate();
    const b = r.allocate();
    expect(a.modalId).not.toBe(b.modalId);
    expect(typeof a.modalId).toBe('string');
    expect(a.modalId.length).toBeGreaterThan(8);
  });

  test('allocate respects explicit modalId injection (test path)', () => {
    const a = r.allocate({ modalId: 'fixed-id' });
    expect(a.modalId).toBe('fixed-id');
    expect(r.get('fixed-id')).toBe(a);
  });

  test('allocate carries kind tag, defaults to "unknown"', () => {
    const tagged = r.allocate({ kind: 'chat-search' });
    const untagged = r.allocate();
    expect(tagged.kind).toBe('chat-search');
    expect(untagged.kind).toBe('unknown');
  });

  test('allocate stores surfaceId hint when supplied', () => {
    const id = r.allocate({ surfaceId: 'chat-search-modal' });
    expect(id.surfaceId).toBe('chat-search-modal');
  });

  test('allocate stamps createdAt from injected clock', () => {
    const id = r.allocate({ now: () => 1700000000000 });
    expect(id.createdAt).toBe(1700000000000);
  });
});

describe('modal-identity · get + lists', () => {
  let r: ModalIdentityRegistry;
  beforeEach(() => { r = createModalIdentityRegistry(); });

  test('get returns identity by modalId', () => {
    const a = r.allocate({ kind: 'dialog' });
    expect(r.get(a.modalId)).toBe(a);
  });

  test('get returns undefined for unknown id', () => {
    expect(r.get('nope')).toBeUndefined();
  });

  test('listOpen contains allocated; listClosed is empty pre-release', () => {
    r.allocate(); r.allocate();
    expect(r.listOpen().length).toBe(2);
    expect(r.listClosed().length).toBe(0);
    expect(r.list().length).toBe(2);
  });

  test('release moves identity from open to closed; get still finds it', () => {
    const a = r.allocate({ kind: 'slash' });
    r.release(a.modalId);
    expect(r.listOpen().length).toBe(0);
    expect(r.listClosed().length).toBe(1);
    expect(r.get(a.modalId)).toBe(a);
  });

  test('release on unknown id is a no-op', () => {
    r.release('does-not-exist');
    expect(r.list().length).toBe(0);
  });
});

describe('modal-identity · promote chain', () => {
  let r: ModalIdentityRegistry;
  beforeEach(() => { r = createModalIdentityRegistry(); });

  test('promote allocates a new identity with promotedFrom backlink', () => {
    const orig = r.allocate({ kind: 'chat-search' });
    const next = r.promote(orig);
    expect(next.modalId).not.toBe(orig.modalId);
    expect(next.promotedFrom).toBe(orig);
    expect(next.kind).toBe('chat-search'); // inherited
  });

  test('promote can override kind', () => {
    const orig = r.allocate({ kind: 'chat-search' });
    const next = r.promote(orig, { kind: 'popover' });
    expect(next.kind).toBe('popover');
    expect(next.promotedFrom?.kind).toBe('chat-search');
  });

  test('promote chain preserves full lineage', () => {
    const a = r.allocate({ kind: 'modal' });
    const b = r.promote(a, { kind: 'popover' });
    const c = r.promote(b, { kind: 'modal' });
    expect(c.promotedFrom?.modalId).toBe(b.modalId);
    expect(c.promotedFrom?.promotedFrom?.modalId).toBe(a.modalId);
    expect(c.promotedFrom?.promotedFrom?.promotedFrom).toBeUndefined();
  });
});

describe('modal-identity · push/pop notifications', () => {
  let r: ModalIdentityRegistry;
  beforeEach(() => { r = createModalIdentityRegistry(); });

  test('notifyPush fires onPush exactly once per identity', () => {
    const seen: ModalLifecycleEvent[] = [];
    r.onPush(e => seen.push(e));
    const id = r.allocate({ kind: 'dialog' });
    r.notifyPush(id, 'surface-1', 'dialog');
    expect(seen.length).toBe(1);
    expect(seen[0]!.identity).toBe(id);
    expect(seen[0]!.surfaceId).toBe('surface-1');
    expect(seen[0]!.tier).toBe('dialog');
  });

  test('duplicate notifyPush is a no-op (idempotent)', () => {
    const seen: ModalLifecycleEvent[] = [];
    r.onPush(e => seen.push(e));
    const id = r.allocate();
    r.notifyPush(id, 's-1');
    r.notifyPush(id, 's-1');
    expect(seen.length).toBe(1);
  });

  test('notifyPop fires onPop only when push has been seen', () => {
    const seen: ModalLifecycleEvent[] = [];
    r.onPop(e => seen.push(e));
    const id = r.allocate();
    r.notifyPop(id, 's-1');         // not pushed → no event
    expect(seen.length).toBe(0);
    r.notifyPush(id, 's-1');
    r.notifyPop(id, 's-1');
    expect(seen.length).toBe(1);
  });

  test('push → pop → push re-emits onPush (lifecycle re-entry)', () => {
    const pushes: ModalLifecycleEvent[] = [];
    r.onPush(e => pushes.push(e));
    const id = r.allocate();
    r.notifyPush(id, 's-1');
    r.notifyPop(id, 's-1');
    r.notifyPush(id, 's-1');
    expect(pushes.length).toBe(2);
  });

  test('unsubscribe stops further events', () => {
    const seen: ModalLifecycleEvent[] = [];
    const dispose = r.onPush(e => seen.push(e));
    r.notifyPush(r.allocate(), 's-1');
    dispose();
    r.notifyPush(r.allocate(), 's-2');
    expect(seen.length).toBe(1);
  });

  test('promote fires onPromote with from/to', () => {
    const events: ModalPromoteEvent[] = [];
    r.onPromote(e => events.push(e));
    const a = r.allocate({ kind: 'modal' });
    const b = r.promote(a, { kind: 'popover', reason: 'pin-to-anchor' });
    expect(events.length).toBe(1);
    expect(events[0]!.from).toBe(a);
    expect(events[0]!.to).toBe(b);
    expect(events[0]!.reason).toBe('pin-to-anchor');
  });

  test('subscriber throw does not break further fanout', () => {
    const good: number[] = [];
    r.onPush(() => { throw new Error('boom'); });
    r.onPush(() => good.push(1));
    r.notifyPush(r.allocate(), 's-1');
    expect(good).toEqual([1]);
  });
});

describe('modal-identity · global singleton', () => {
  test('getModalIdentityRegistry returns the same instance across calls', () => {
    const a = getModalIdentityRegistry();
    const b = getModalIdentityRegistry();
    expect(a).toBe(b);
  });

  test('__setGlobalModalIdentityRegistry swaps the singleton', () => {
    const fresh = createModalIdentityRegistry();
    const prev = __setGlobalModalIdentityRegistry(fresh);
    try {
      expect(getModalIdentityRegistry()).toBe(fresh);
    } finally {
      __setGlobalModalIdentityRegistry(prev);
    }
  });
});

describe('modal-identity · reset', () => {
  test('reset clears open/closed/subscribers', () => {
    const r = createModalIdentityRegistry();
    const seen: number[] = [];
    r.onPush(() => seen.push(1));
    const id = r.allocate();
    r.notifyPush(id, 's-1');
    r.reset();
    expect(r.list().length).toBe(0);
    // After reset, old subscribers should not see new events.
    const id2 = r.allocate();
    r.notifyPush(id2, 's-2');
    expect(seen).toEqual([1]); // only the pre-reset event
  });
});
