// ── VW-term-infra Bundle A · A3 — PaneVisualState unit tests ──
//
// Hermetic — no live Pane, no dashboard. Creates a fresh store per
// test and exercises snapshot / setState / subscribe / legal
// transitions / isAltSkipEligible.

import { describe, expect, test } from 'bun:test';

import {
  createVisualStateStore,
  isAltSkipEligible,
  DEFAULT_VISUAL_STATE,
  PANE_FOCUS,
  PANE_FOCUS_POLICY,
  PANE_PLACEMENT,
  PANE_VISIBILITY,
  type PaneVisualState,
} from '../src/panes/visual-state.js';
import type { PaneRef } from '../src/panes/types.js';

const ref: PaneRef = { windowId: 'w1', paneId: 'p1' };
const ref2: PaneRef = { windowId: 'w1', paneId: 'p2' };

// ── Snapshot + defaults ─────────────────────────────────────────

describe('createVisualStateStore · defaults + snapshot', () => {
  test('unknown ref → default state', () => {
    const store = createVisualStateStore();
    expect(store.snapshot(ref)).toEqual(DEFAULT_VISUAL_STATE);
  });

  test('keys() empty until first setState', () => {
    const store = createVisualStateStore();
    store.snapshot(ref);
    expect(store.keys()).toEqual([]);
    store.setState(ref, { visibility: PANE_VISIBILITY.hidden });
    expect(store.keys()).toHaveLength(1);
  });

  test('DEFAULT_VISUAL_STATE is frozen (no accidental mutation)', () => {
    expect(Object.isFrozen(DEFAULT_VISUAL_STATE)).toBe(true);
  });
});

// ── setState + equality ─────────────────────────────────────────

describe('createVisualStateStore · setState semantics', () => {
  test('partial patch merges with current state', () => {
    const store = createVisualStateStore();
    store.setState(ref, { visibility: PANE_VISIBILITY.hidden });
    const snap = store.snapshot(ref);
    expect(snap.visibility).toBe(PANE_VISIBILITY.hidden);
    expect(snap.focus).toBe(DEFAULT_VISUAL_STATE.focus);
  });

  test('identical state → no emission, returns false', () => {
    const store = createVisualStateStore();
    store.setState(ref, { visibility: PANE_VISIBILITY.hidden });
    const received: PaneVisualState[] = [];
    store.subscribe(ref, (s) => received.push(s));
    // prime fire is 1 call
    expect(received).toHaveLength(1);
    const ok = store.setState(ref, { visibility: PANE_VISIBILITY.hidden });
    expect(ok).toBe(false);
    expect(received).toHaveLength(1);
  });

  test('changed state → returns true + fires subscribers', () => {
    const store = createVisualStateStore();
    const received: PaneVisualState[] = [];
    store.subscribe(ref, (s) => received.push(s));
    expect(received).toHaveLength(1); // prime
    const ok = store.setState(ref, { focus: PANE_FOCUS.focused });
    expect(ok).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[1]!.focus).toBe(PANE_FOCUS.focused);
  });

  test('illegal transition: dormant → focused is blocked', () => {
    const store = createVisualStateStore();
    store.setState(ref, { visibility: PANE_VISIBILITY.dormant });
    const ok = store.setState(ref, { focus: PANE_FOCUS.focused });
    expect(ok).toBe(false);
    expect(store.snapshot(ref).focus).toBe(DEFAULT_VISUAL_STATE.focus);
  });

  test('illegal transition: no-focus policy blocks focus', () => {
    const store = createVisualStateStore();
    store.setState(ref, { focusPolicy: PANE_FOCUS_POLICY['no-focus'] });
    const ok = store.setState(ref, { focus: PANE_FOCUS.focused });
    expect(ok).toBe(false);
  });

  test('illegal: zoomed + hidden rejected', () => {
    const store = createVisualStateStore();
    const ok = store.setState(ref, {
      placement: PANE_PLACEMENT.zoomed,
      visibility: PANE_VISIBILITY.hidden,
    });
    expect(ok).toBe(false);
  });
});

// ── Subscribe + multi-ref isolation ─────────────────────────────

describe('createVisualStateStore · subscribe', () => {
  test('two subscribers each get updates', () => {
    const store = createVisualStateStore();
    const a: PaneVisualState[] = [];
    const b: PaneVisualState[] = [];
    store.subscribe(ref, (s) => a.push(s));
    store.subscribe(ref, (s) => b.push(s));
    store.setState(ref, { visibility: PANE_VISIBILITY['llm-only'] });
    expect(a.at(-1)!.visibility).toBe(PANE_VISIBILITY['llm-only']);
    expect(b.at(-1)!.visibility).toBe(PANE_VISIBILITY['llm-only']);
  });

  test('unsubscribe stops further calls', () => {
    const store = createVisualStateStore();
    const received: PaneVisualState[] = [];
    const off = store.subscribe(ref, (s) => received.push(s));
    off();
    store.setState(ref, { focus: PANE_FOCUS.focused });
    // Only the prime fire should remain.
    expect(received).toHaveLength(1);
  });

  test('subscribers for ref A are not fired by setState on ref B', () => {
    const store = createVisualStateStore();
    const rcvA: PaneVisualState[] = [];
    store.subscribe(ref, (s) => rcvA.push(s));
    store.setState(ref2, { focus: PANE_FOCUS.focused });
    // Prime fire only — setState on ref2 must not reach ref subscribers.
    expect(rcvA).toHaveLength(1);
  });

  test('forget() drops state + subs', () => {
    const store = createVisualStateStore();
    store.setState(ref, { visibility: PANE_VISIBILITY.hidden });
    store.forget(ref);
    expect(store.keys()).toEqual([]);
    expect(store.snapshot(ref)).toEqual(DEFAULT_VISUAL_STATE);
  });
});

// ── isAltSkipEligible ───────────────────────────────────────────

describe('isAltSkipEligible · demo consumer', () => {
  test('default state is NOT skip-eligible', () => {
    expect(isAltSkipEligible(DEFAULT_VISUAL_STATE)).toBe(false);
  });

  test('hidden / dormant / skip / no-focus → all eligible', () => {
    const base = DEFAULT_VISUAL_STATE;
    expect(isAltSkipEligible({ ...base, visibility: PANE_VISIBILITY.hidden })).toBe(true);
    expect(isAltSkipEligible({ ...base, visibility: PANE_VISIBILITY.dormant })).toBe(true);
    expect(isAltSkipEligible({ ...base, focusPolicy: PANE_FOCUS_POLICY.skip })).toBe(true);
    expect(isAltSkipEligible({ ...base, focusPolicy: PANE_FOCUS_POLICY['no-focus'] })).toBe(true);
  });

  test('llm-only visibility is NOT Alt+N skip (LLM-only is an opt-in render flag, not a focus-cycle flag)', () => {
    // Product decision: Alt+N still cycles through llm-only panes —
    // author's intent is "LLM can describe this", not "hide from user
    // cycling". Separate from hidden.
    const s: PaneVisualState = { ...DEFAULT_VISUAL_STATE, visibility: PANE_VISIBILITY['llm-only'] };
    expect(isAltSkipEligible(s)).toBe(false);
  });
});
