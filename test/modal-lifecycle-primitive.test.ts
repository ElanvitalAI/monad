// Phase B-1 of PLAN-modal-lifecycle-primitive.md. Unit tests pin
// the contract behaviour so Phase B-2 (coordinator migration) can
// trust the primitive as the source of truth for modal state.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ModalBounds, ModalSurface } from '../src/display/modal-stack.js';
import {
  DEFAULT_POLICY,
  __resetGenerationForTests,
  createModalLifecycle,
  ModalHandle,
  ModalType,
  ModalLifecycleEvent,
  nextGeneration,
} from '../src/primitives/modal-lifecycle/index.js';

// Minimal ModalSurface stub — paint/onKey/bounds just enough to
// satisfy the shape. Tests don't exercise the render path.
function makeSurface(id: string, bounds?: ModalBounds): ModalSurface {
  return {
    id: id as ModalSurface['id'],
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 250,
    bounds: bounds ?? { row: 1, col: 1, width: 10, height: 5 },
    render: () => [],
    paint: () => '',
  };
}

function dialogType(name: string): ModalType {
  return {
    name,
    tier: 'dialog',
    factory: (ctx) => makeSurface(ctx.id),
  };
}

function popupType(name: string): ModalType {
  return {
    name,
    tier: 'popup',
    factory: (ctx) => makeSurface(ctx.id),
  };
}

beforeEach(() => {
  __resetGenerationForTests();
});

describe('ModalLifecycle · type registration (Textual install_screen)', () => {
  test('registerType throws on duplicate name', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('dup'));
    expect(() => mlc.registerType(dialogType('dup'))).toThrow(/already registered/);
  });

  test('disposer releases the name so re-register works', () => {
    const mlc = createModalLifecycle();
    const t1 = dialogType('rename');
    const off = mlc.registerType(t1);
    off();
    expect(mlc.isTypeRegistered('rename')).toBe(false);
    // New type under same name is now legal.
    expect(() => mlc.registerType(dialogType('rename'))).not.toThrow();
  });

  test('disposer is idempotent · calling twice is safe', () => {
    const mlc = createModalLifecycle();
    const off = mlc.registerType(dialogType('idem'));
    off();
    expect(() => off()).not.toThrow();
  });

  test('disposer does not unregister a later replacement', () => {
    // Regression guard: scenario (a) registerType('X') returns off1,
    // (b) off1() fires, (c) registerType('X') returns off2, (d) off1()
    // fires AGAIN — must not drop the new registration.
    const mlc = createModalLifecycle();
    const t1 = dialogType('guarded');
    const off1 = mlc.registerType(t1);
    off1();
    const t2 = dialogType('guarded');
    mlc.registerType(t2);
    off1();
    expect(mlc.isTypeRegistered('guarded')).toBe(true);
  });

  test('push with unregistered typeName throws', () => {
    const mlc = createModalLifecycle();
    expect(() => mlc.push('nonexistent')).toThrow(/no modal type/);
  });
});

describe('ModalLifecycle · push / handle basics', () => {
  test('push returns a handle with a fresh generation', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('d'));
    const h = mlc.push('d');
    expect(h).not.toBeNull();
    expect(h!.generation).toBeGreaterThan(0);
    expect(h!.typeName).toBe('d');
    expect(h!.tier).toBe('dialog');
    expect(h!.isDisposed()).toBe(false);
  });

  test('successive pushes get monotonically increasing generations', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('d'));
    const h1 = mlc.push('d');
    const h2 = mlc.push('d');
    expect(h2!.generation).toBeGreaterThan(h1!.generation);
  });

  test('handle.id encodes typeName + generation for debuggability', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('logme'));
    const h = mlc.push('logme')!;
    expect(h.id).toContain('logme');
    expect(h.id).toContain('#g');
  });

  test('stackOrder reflects push order', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    mlc.registerType(dialogType('b'));
    const ha = mlc.push('a')!;
    const hb = mlc.push('b')!;
    const order = mlc.stackOrder();
    expect(order).toHaveLength(2);
    expect(order[0]!.id).toBe(ha.id);
    expect(order[1]!.id).toBe(hb.id);
  });
});

describe('ModalLifecycle · idempotencyKey (React portal+key)', () => {
  test('default replace: same (typeName,key) dispose prior then mount new', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('attach'));
    const h1 = mlc.push('attach', { idempotencyKey: 'attach-1' })!;
    const h2 = mlc.push('attach', { idempotencyKey: 'attach-1' })!;
    expect(h1.isDisposed()).toBe(true);
    expect(h2.isDisposed()).toBe(false);
    expect(h1.id).not.toBe(h2.id);
    // Only ONE instance on stack.
    expect(mlc.stackOrder()).toHaveLength(1);
    expect(mlc.stackOrder()[0]!.id).toBe(h2.id);
  });

  test('duplicateBehavior=reject: second push returns null', () => {
    const mlc = createModalLifecycle({ duplicateBehavior: 'reject' });
    mlc.registerType(dialogType('attach'));
    const h1 = mlc.push('attach', { idempotencyKey: 'k' });
    const h2 = mlc.push('attach', { idempotencyKey: 'k' });
    expect(h1).not.toBeNull();
    expect(h2).toBeNull();
    expect(h1!.isDisposed()).toBe(false);
    expect(mlc.stackOrder()).toHaveLength(1);
  });

  test('duplicateBehavior=allow: both stack', () => {
    const mlc = createModalLifecycle({ duplicateBehavior: 'allow' });
    mlc.registerType(dialogType('attach'));
    mlc.push('attach', { idempotencyKey: 'k' });
    mlc.push('attach', { idempotencyKey: 'k' });
    expect(mlc.stackOrder()).toHaveLength(2);
  });

  test('different keys for same type do NOT trigger dedup', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('attach'));
    const h1 = mlc.push('attach', { idempotencyKey: 'row-1' })!;
    const h2 = mlc.push('attach', { idempotencyKey: 'row-2' })!;
    expect(h1.isDisposed()).toBe(false);
    expect(h2.isDisposed()).toBe(false);
    expect(mlc.stackOrder()).toHaveLength(2);
  });

  test('same key across different types does NOT conflict', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    mlc.registerType(dialogType('b'));
    const ha = mlc.push('a', { idempotencyKey: 'same' })!;
    const hb = mlc.push('b', { idempotencyKey: 'same' })!;
    expect(ha.isDisposed()).toBe(false);
    expect(hb.isDisposed()).toBe(false);
    expect(mlc.stackOrder()).toHaveLength(2);
  });

  test('null idempotencyKey → always stack (legacy caller)', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    mlc.push('a');
    mlc.push('a');
    mlc.push('a', { idempotencyKey: null });
    expect(mlc.stackOrder()).toHaveLength(3);
  });

  test('byKey lookup finds live handle', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h = mlc.push('a', { idempotencyKey: 'target' })!;
    expect(mlc.byKey('a', 'target')!.id).toBe(h.id);
    expect(mlc.byKey('a', 'no-such')).toBeNull();
    expect(mlc.byKey('unknown-type', 'target')).toBeNull();
  });

  test('byKey skips disposed handles', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h = mlc.push('a', { idempotencyKey: 'gone' })!;
    h.dispose();
    expect(mlc.byKey('a', 'gone')).toBeNull();
  });
});

describe('ModalLifecycle · pop / popTier / invalidateOnDispose', () => {
  test('pop by id disposes the handle + removes from stack', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h = mlc.push('a')!;
    expect(mlc.pop(h.id)).toBe(true);
    expect(h.isDisposed()).toBe(true);
    expect(mlc.stackOrder()).toHaveLength(0);
  });

  test('pop non-existent id returns false (no throw)', () => {
    const mlc = createModalLifecycle();
    expect(mlc.pop('nope' as ModalHandle['id'])).toBe(false);
  });

  test('handle.dispose is idempotent', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h = mlc.push('a')!;
    h.dispose();
    expect(() => h.dispose()).not.toThrow();
    expect(h.isDisposed()).toBe(true);
  });

  test('popTier disposes every modal in the tier', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('d1'));
    mlc.registerType(dialogType('d2'));
    mlc.registerType(popupType('p1'));
    mlc.push('d1');
    mlc.push('d2');
    mlc.push('p1');
    const count = mlc.popTier('dialog');
    expect(count).toBe(2);
    expect(mlc.stackOrder()).toHaveLength(1);
    expect(mlc.stackOrder()[0]!.tier).toBe('popup');
  });

  test('popTier returns 0 when tier empty', () => {
    const mlc = createModalLifecycle();
    expect(mlc.popTier('dialog')).toBe(0);
  });

  test('disposed handle emits disposed AND invalidate events by default', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const events: string[] = [];
    mlc.on('disposed', () => events.push('disposed'));
    mlc.on('invalidate', () => events.push('invalidate'));
    const h = mlc.push('a')!;
    h.dispose();
    expect(events).toEqual(['disposed', 'invalidate']);
  });

  test('invalidateOnDispose=false suppresses the invalidate event', () => {
    const mlc = createModalLifecycle({ invalidateOnDispose: false });
    mlc.registerType(dialogType('a'));
    const events: string[] = [];
    mlc.on('disposed', () => events.push('disposed'));
    mlc.on('invalidate', () => events.push('invalidate'));
    const h = mlc.push('a')!;
    h.dispose();
    expect(events).toEqual(['disposed']);
  });

  test('disposed + invalidate arrive in same synchronous cycle (Flutter atomic)', () => {
    // Guard the sync-ness claim: no microtask between the two. If a
    // listener sets a flag on 'disposed' and checks it on 'invalidate',
    // the flag must still be true (same stack frame).
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    let sawFlag = false;
    let flag = false;
    mlc.on('disposed', () => { flag = true; });
    mlc.on('invalidate', () => { sawFlag = flag; });
    const h = mlc.push('a')!;
    h.dispose();
    expect(sawFlag).toBe(true);
  });
});

describe('ModalLifecycle · events', () => {
  test('mounted fires once per push', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    let count = 0;
    mlc.on('mounted', () => { count++; });
    mlc.push('a');
    mlc.push('a');
    expect(count).toBe(2);
  });

  test('top-changed fires on push', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const seen: string[] = [];
    mlc.on('top-changed', (ev) => seen.push(ev.handle.tier));
    mlc.push('a');
    expect(seen).toContain('dialog');
  });

  test('listener disposer stops future callbacks', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    let count = 0;
    const off = mlc.on('mounted', () => { count++; });
    mlc.push('a');
    off();
    mlc.push('a');
    expect(count).toBe(1);
  });

  test('listener throws do not break the emit chain', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    let second = 0;
    mlc.on('mounted', () => { throw new Error('boom'); });
    mlc.on('mounted', () => { second++; });
    expect(() => mlc.push('a')).not.toThrow();
    expect(second).toBe(1);
  });

  test('event payload carries the handle', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const seen: ModalLifecycleEvent[] = [];
    mlc.on('mounted', (ev) => seen.push(ev));
    const h = mlc.push('a')!;
    expect(seen[0]!.handle.id).toBe(h.id);
    expect(seen[0]!.handle.generation).toBe(h.generation);
  });

  test('replace-cycle emits disposed(prior) then mounted(next)', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const events: string[] = [];
    mlc.on('disposed', (ev) => events.push(`disposed:${ev.handle.generation}`));
    mlc.on('mounted', (ev) => events.push(`mounted:${ev.handle.generation}`));
    const h1 = mlc.push('a', { idempotencyKey: 'k' })!;
    // First-push produces a 'mounted' event; clear so the assertions
    // below look only at the replace cycle.
    events.length = 0;
    const h2 = mlc.push('a', { idempotencyKey: 'k' })!;
    // The prior must dispose BEFORE the new mounts — otherwise two
    // modals would briefly coexist on the stack.
    const disposedIdx = events.indexOf(`disposed:${h1.generation}`);
    const mountedIdx = events.indexOf(`mounted:${h2.generation}`);
    expect(disposedIdx).toBeGreaterThanOrEqual(0);
    expect(mountedIdx).toBeGreaterThan(disposedIdx);
  });
});

describe('ModalLifecycle · topOfTier / stack query', () => {
  test('topOfTier returns null when tier empty', () => {
    const mlc = createModalLifecycle();
    expect(mlc.topOfTier('dialog')).toBeNull();
  });

  test('topOfTier returns the most-recent push of that tier', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('d1'));
    mlc.registerType(dialogType('d2'));
    mlc.registerType(popupType('p1'));
    mlc.push('d1');
    const h = mlc.push('d2')!;
    mlc.push('p1');
    // d2 is still the top dialog even though a popup pushed after.
    expect(mlc.topOfTier('dialog')!.id).toBe(h.id);
    expect(mlc.topOfTier('popup')!.typeName).toBe('p1');
  });

  test('topOfTier skips disposed handles', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h1 = mlc.push('a')!;
    const h2 = mlc.push('a')!;
    h2.dispose();
    expect(mlc.topOfTier('dialog')!.id).toBe(h1.id);
  });
});

describe('ModalLifecycle · TC39 using (Symbol.dispose)', () => {
  test('Symbol.dispose is wired to the same action as dispose()', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h = mlc.push('a')!;
    h[Symbol.dispose]();
    expect(h.isDisposed()).toBe(true);
    expect(mlc.stackOrder()).toHaveLength(0);
  });

  test('Symbol.dispose is idempotent (like dispose)', () => {
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h = mlc.push('a')!;
    h[Symbol.dispose]();
    expect(() => h[Symbol.dispose]()).not.toThrow();
  });
});

describe('ModalLifecycle · policy defaults', () => {
  test('DEFAULT_POLICY matches PLAN contract', () => {
    expect(DEFAULT_POLICY.invalidateOnDispose).toBe(true);
    expect(DEFAULT_POLICY.duplicateBehavior).toBe('replace');
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true);
  });

  test('partial policy override keeps non-overridden fields default', () => {
    const mlc = createModalLifecycle({ duplicateBehavior: 'allow' });
    expect(mlc.policy.duplicateBehavior).toBe('allow');
    expect(mlc.policy.invalidateOnDispose).toBe(true);
  });
});

describe('ModalLifecycle · generation counter (AppCUI-rs Handle<T>)', () => {
  test('nextGeneration is strictly monotonic within test', () => {
    __resetGenerationForTests();
    const g1 = nextGeneration();
    const g2 = nextGeneration();
    const g3 = nextGeneration();
    expect(g1).toBeLessThan(g2);
    expect(g2).toBeLessThan(g3);
  });

  test('stale handle reference reports isDisposed after cycle', () => {
    // Scenario: external code holds h1 → primitive disposes + reuses
    // the id. Stale handle MUST NOT appear as live.
    const mlc = createModalLifecycle();
    mlc.registerType(dialogType('a'));
    const h1 = mlc.push('a', { idempotencyKey: 'k' })!;
    mlc.push('a', { idempotencyKey: 'k' });
    // h1 was replaced. Its isDisposed must be true.
    expect(h1.isDisposed()).toBe(true);
  });
});
