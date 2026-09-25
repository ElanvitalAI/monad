// ── F-1 · FocusManager primitive tests ──
//
// Validates the contract PLAN-focus-manager-primitive.md §3 + the
// 4 implementation-level pitfalls raised in the Session B SYNC
// (PR #282 §2):
//   - generation counter shared with ModalLifecycle
//   - pathTo cycle guard (depth cap 64 + visited Set)
//   - listener throw isolation
//   - restorePrevious 1-level depth
//
// Tests use the primitive's public surface only — impl details
// (FocusNodeInternal, insertion index) are not asserted so F-2/F-3
// can evolve internals freely.

import { describe, expect, test } from 'bun:test';
import {
  createFocusManager,
  PATH_DEPTH_CAP,
  type FocusManager,
  type FocusNodeRef,
  type FocusEvent,
} from '../src/primitives/focus-manager/index.js';

const node = (overrides: Partial<FocusNodeRef> & { id: string }): FocusNodeRef => ({
  scope: 'pane',
  focusable: true,
  priority: 100,
  owner: 'dashboard',
  ...overrides,
});

// ─── Registration ───

describe('FocusManager · register / unregister', () => {
  test('register returns disposer that unregisters', () => {
    const fm = createFocusManager();
    const dispose = fm.register(node({ id: 'a' }));
    expect(fm.isRegistered('a')).toBe(true);
    dispose();
    expect(fm.isRegistered('a')).toBe(false);
  });

  test('unregister is idempotent for unknown id', () => {
    const fm = createFocusManager();
    expect(() => fm.unregister('ghost')).not.toThrow();
  });

  test('register throws on duplicate id', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    expect(() => fm.register(node({ id: 'a' }))).toThrow(/already registered/);
  });

  test('disposer is idempotent — calling twice is safe', () => {
    const fm = createFocusManager();
    const d = fm.register(node({ id: 'a' }));
    d();
    d();
    expect(fm.isRegistered('a')).toBe(false);
  });

  test('re-register after unregister works', () => {
    const fm = createFocusManager();
    const d1 = fm.register(node({ id: 'a', priority: 1 }));
    d1();
    fm.register(node({ id: 'a', priority: 2 }));
    expect(fm.isRegistered('a')).toBe(true);
  });

  test('unregister prunes active/previous/history references', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    fm.unregister('a');
    expect(fm.state().previous).toBeNull();
    expect(fm.state().history).not.toContain('a');
    // active=b still valid
    expect(fm.state().active).toBe('b');
  });
});

// ─── setFocus ───

describe('FocusManager · setFocus', () => {
  test('sets active + records previous + updates history', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    const s = fm.state();
    expect(s.active).toBe('b');
    expect(s.previous).toBe('a');
    expect(s.history).toEqual(['a', 'b']);
  });

  test('returns false for unknown id · no state change', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.setFocus('a', 'init');
    expect(fm.setFocus('ghost', 'bad')).toBe(false);
    expect(fm.state().active).toBe('a');
  });

  test('returns false for non-focusable node', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', focusable: false }));
    expect(fm.setFocus('a', 'bad')).toBe(false);
    expect(fm.state().active).toBeNull();
  });

  test('idempotent when active already matches id', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.setFocus('a', 'init');
    const snap = fm.state();
    expect(fm.setFocus('a', 'again')).toBe(true);
    // state unchanged (same array ref for history when no append)
    expect(fm.state().active).toBe(snap.active);
    expect(fm.state().history).toBe(snap.history);
  });

  test('emits focused event with prior=null on first focus', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    const evs: FocusEvent[] = [];
    fm.on('focused', (ev) => evs.push(ev));
    fm.setFocus('a', 'init');
    expect(evs).toHaveLength(1);
    expect(evs[0]!.node?.id).toBe('a');
    expect(evs[0]!.prior).toBeNull();
    expect(evs[0]!.reason).toBe('init');
  });

  test('emits blurred event for prior node when switching focus', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    const blurs: FocusEvent[] = [];
    fm.on('blurred', (ev) => blurs.push(ev));
    fm.setFocus('b', 'step');
    expect(blurs).toHaveLength(1);
    expect(blurs[0]!.node?.id).toBe('a');
  });
});

// ─── clear ───

describe('FocusManager · clear', () => {
  test('clear drops active and emits blur', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.setFocus('a', 'init');
    const blurs: FocusEvent[] = [];
    fm.on('blurred', (ev) => blurs.push(ev));
    fm.clear('dismiss');
    expect(fm.state().active).toBeNull();
    expect(fm.state().previous).toBe('a');
    expect(blurs).toHaveLength(1);
  });

  test('clear when already cleared is a no-op', () => {
    const fm = createFocusManager();
    const blurs: FocusEvent[] = [];
    fm.on('blurred', (ev) => blurs.push(ev));
    fm.clear('noop');
    expect(blurs).toHaveLength(0);
    expect(fm.state().active).toBeNull();
  });
});

// ─── restorePrevious (1-level depth · Session B SYNC §2.4) ───

describe('FocusManager · restorePrevious', () => {
  test('restores previous node and emits restored event', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    const restored: FocusEvent[] = [];
    fm.on('restored', (ev) => restored.push(ev));
    expect(fm.restorePrevious('undo')).toBe(true);
    expect(fm.state().active).toBe('a');
    expect(restored).toHaveLength(1);
    expect(restored[0]!.node?.id).toBe('a');
  });

  test('restorePrevious is 1-level deep — double-restore ping-pongs', () => {
    // Session B SYNC §2.4 pin: active↔previous swap, not a multi-
    // level undo stack.
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.register(node({ id: 'c' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    fm.setFocus('c', 'step');
    fm.restorePrevious('undo');
    expect(fm.active()?.id).toBe('b');
    fm.restorePrevious('undo');
    // c was previous; ping-pong back to c — NOT deep-undo to a
    expect(fm.active()?.id).toBe('c');
  });

  test('returns false when no previous available', () => {
    const fm = createFocusManager();
    expect(fm.restorePrevious('nothing')).toBe(false);
  });

  test('returns false when previous node was unregistered', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    fm.unregister('a');
    expect(fm.restorePrevious('stale')).toBe(false);
  });

  test('returns false when previous node lost focusable', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', focusable: true }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    // Simulate node losing focusable by re-registering with focusable=false
    fm.unregister('a');
    fm.register(node({ id: 'a', focusable: false }));
    expect(fm.restorePrevious('degraded')).toBe(false);
  });
});

// ─── cycle ───

describe('FocusManager · cycle (priority policy · default)', () => {
  test('picks highest-priority focusable in scope when no active', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'low', scope: 'pane', priority: 10 }));
    fm.register(node({ id: 'hi',  scope: 'pane', priority: 90 }));
    const next = fm.cycle('pane', 1, 'tab');
    expect(next).toBe('hi');
  });

  test('advances across priority-sorted pool with wrap-around', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', scope: 'pane', priority: 90 }));
    fm.register(node({ id: 'b', scope: 'pane', priority: 50 }));
    fm.register(node({ id: 'c', scope: 'pane', priority: 10 }));
    fm.setFocus('a', 'init');
    expect(fm.cycle('pane', 1, 'tab')).toBe('b');
    expect(fm.cycle('pane', 1, 'tab')).toBe('c');
    expect(fm.cycle('pane', 1, 'tab')).toBe('a');  // wrap
  });

  test('dir=-1 cycles backward', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', priority: 90 }));
    fm.register(node({ id: 'b', priority: 50 }));
    fm.setFocus('a', 'init');
    expect(fm.cycle('pane', -1, 'shift-tab')).toBe('b');  // wrap to last
  });

  test('skips non-focusable nodes', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', priority: 90 }));
    fm.register(node({ id: 'b', priority: 50, focusable: false }));
    fm.register(node({ id: 'c', priority: 10 }));
    fm.setFocus('a', 'init');
    expect(fm.cycle('pane', 1, 'tab')).toBe('c');  // b skipped
  });

  test('returns null when no focusable nodes in scope', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', scope: 'widget' }));
    expect(fm.cycle('modal', 1, 'tab')).toBeNull();
  });

  test('emits cycled event', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', priority: 90 }));
    fm.register(node({ id: 'b', priority: 50 }));
    fm.setFocus('a', 'init');
    const evs: FocusEvent[] = [];
    fm.on('cycled', (ev) => evs.push(ev));
    fm.cycle('pane', 1, 'tab');
    expect(evs).toHaveLength(1);
    expect(evs[0]!.node?.id).toBe('b');
    expect(evs[0]!.prior?.id).toBe('a');
  });
});

describe('FocusManager · cycle (order policy)', () => {
  test('picks first inserted node when no active', () => {
    const fm = createFocusManager({ policy: 'order' });
    fm.register(node({ id: 'first', priority: 10 }));
    fm.register(node({ id: 'second', priority: 90 }));  // higher but later
    expect(fm.cycle('pane', 1, 'tab')).toBe('first');
  });

  test('cycles in insertion order regardless of priority', () => {
    const fm = createFocusManager({ policy: 'order' });
    fm.register(node({ id: 'first', priority: 10 }));
    fm.register(node({ id: 'second', priority: 90 }));
    fm.register(node({ id: 'third', priority: 50 }));
    fm.setFocus('first', 'init');
    expect(fm.cycle('pane', 1, 'tab')).toBe('second');
    expect(fm.cycle('pane', 1, 'tab')).toBe('third');
    expect(fm.cycle('pane', 1, 'tab')).toBe('first');  // wrap
  });
});

// ─── pathTo · focusChain (AppCUI-rs pattern + Session B SYNC §2.2 cycle guard) ───

describe('FocusManager · pathTo / focusChain', () => {
  test('single node with no parent returns just that node', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    expect(fm.pathTo('a').map((n) => n.id)).toEqual(['a']);
  });

  test('parent chain returns root → leaf order', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'root', parent: null }));
    fm.register(node({ id: 'mid', parent: 'root' }));
    fm.register(node({ id: 'leaf', parent: 'mid' }));
    expect(fm.pathTo('leaf').map((n) => n.id)).toEqual(['root', 'mid', 'leaf']);
  });

  test('orphan node (parent refers to unregistered id) stops at known', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', parent: 'ghost' }));
    expect(fm.pathTo('a').map((n) => n.id)).toEqual(['a']);
  });

  test('pathTo on unknown id returns empty', () => {
    const fm = createFocusManager();
    expect(fm.pathTo('ghost')).toEqual([]);
  });

  test('cycle guard · A.parent=B, B.parent=A does NOT infinite loop', () => {
    // Session B SYNC §2.2 — depth cap + visited Set.
    const fm = createFocusManager();
    fm.register(node({ id: 'a', parent: 'b' }));
    fm.register(node({ id: 'b', parent: 'a' }));
    const path = fm.pathTo('a');
    // Must terminate · must contain both nodes at most.
    expect(path.length).toBeLessThanOrEqual(2);
    expect(path.length).toBeGreaterThanOrEqual(1);
  });

  test('depth cap · 100-deep ancestor chain truncates at PATH_DEPTH_CAP', () => {
    // Session B SYNC §2.2 — PATH_DEPTH_CAP = 64.
    const fm = createFocusManager();
    // Build a 100-node chain: n99 → n98 → ... → n0
    for (let i = 0; i < 100; i++) {
      const parent = i === 0 ? null : `n${i - 1}`;
      fm.register(node({ id: `n${i}`, parent }));
    }
    const path = fm.pathTo('n99');
    expect(path.length).toBe(PATH_DEPTH_CAP);
    // Because we cap at 64 starting from the leaf, the returned path
    // (after reverse) ends at n99 but its earliest ancestor is
    // somewhere around n36. Just assert the leaf is last and length
    // equals cap.
    expect(path[path.length - 1]!.id).toBe('n99');
  });

  test('focusChain returns pathTo(active)', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'root', parent: null }));
    fm.register(node({ id: 'leaf', parent: 'root' }));
    fm.setFocus('leaf', 'init');
    expect(fm.focusChain().map((n) => n.id)).toEqual(['root', 'leaf']);
  });

  test('focusChain returns empty when no active', () => {
    const fm = createFocusManager();
    expect(fm.focusChain()).toEqual([]);
  });
});

// ─── focusableInScope ───

describe('FocusManager · focusableInScope', () => {
  test('filters by scope and focusable flag', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a', scope: 'pane', focusable: true }));
    fm.register(node({ id: 'b', scope: 'pane', focusable: false }));
    fm.register(node({ id: 'c', scope: 'modal', focusable: true }));
    const pool = fm.focusableInScope('pane');
    expect(pool.map((n) => n.id)).toEqual(['a']);
  });

  test('sorts by policy priority (desc · default)', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'lo', priority: 10 }));
    fm.register(node({ id: 'hi', priority: 90 }));
    fm.register(node({ id: 'md', priority: 50 }));
    const pool = fm.focusableInScope('pane');
    expect(pool.map((n) => n.id)).toEqual(['hi', 'md', 'lo']);
  });
});

// ─── Event subscription + listener throw isolation (SYNC §2.3) ───

describe('FocusManager · event subscription', () => {
  test('multiple listeners all receive event', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    let a = 0, b = 0;
    fm.on('focused', () => { a++; });
    fm.on('focused', () => { b++; });
    fm.setFocus('a', 'init');
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test('disposer removes only that listener', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    let a = 0, b = 0;
    const d = fm.on('focused', () => { a++; });
    fm.on('focused', () => { b++; });
    d();
    fm.setFocus('a', 'init');
    expect(a).toBe(0);
    expect(b).toBe(1);
  });

  test('listener throw isolation — other listeners still fire', () => {
    // Session B SYNC §2.3 — B-1 pattern: try/catch per listener.
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    let survived = 0;
    fm.on('focused', () => { throw new Error('boom'); });
    fm.on('focused', () => { survived++; });
    // Must not throw out of setFocus.
    expect(() => fm.setFocus('a', 'init')).not.toThrow();
    expect(survived).toBe(1);
  });

  test('listener throw does not break primitive state', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.on('focused', () => { throw new Error('boom'); });
    fm.setFocus('a', 'init');
    // State after throwing listener should still be correct.
    expect(fm.active()?.id).toBe('a');
    fm.setFocus('b', 'step');
    expect(fm.active()?.id).toBe('b');
    expect(fm.state().previous).toBe('a');
  });
});

// ─── Policy default + explicit ───

describe('FocusManager · policy', () => {
  test('default policy is priority', () => {
    const fm = createFocusManager();
    expect(fm.policy).toBe('priority');
  });

  test('explicit order policy sets policy field', () => {
    const fm = createFocusManager({ policy: 'order' });
    expect(fm.policy).toBe('order');
  });
});

// ─── state snapshot ───

describe('FocusManager · state()', () => {
  test('returns current state snapshot', () => {
    const fm = createFocusManager();
    fm.register(node({ id: 'a' }));
    fm.register(node({ id: 'b' }));
    fm.setFocus('a', 'init');
    fm.setFocus('b', 'step');
    const s = fm.state();
    expect(s.active).toBe('b');
    expect(s.previous).toBe('a');
    expect(s.history).toEqual(['a', 'b']);
  });

  test('initial state has active=null · previous=null · empty history', () => {
    const fm: FocusManager = createFocusManager();
    const s = fm.state();
    expect(s.active).toBeNull();
    expect(s.previous).toBeNull();
    expect(s.history).toEqual([]);
  });
});
