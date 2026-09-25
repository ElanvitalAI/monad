// ── VW-term-infra Bundle B-1 · B1-2 — describe-with-state tests ──

import { describe, expect, test } from 'bun:test';

import { describePaneWithState } from '../src/panes/describe-with-state.js';
import {
  createVisualStateStore,
  PANE_FOCUS_POLICY,
  PANE_VISIBILITY,
} from '../src/panes/visual-state.js';
import type { PaneRef } from '../src/panes/types.js';

const missingRef: PaneRef = { windowId: 'w-none', paneId: 'p-none' };

describe('describePaneWithState', () => {
  test('pane unknown → found:false · visualState present as default', () => {
    const store = createVisualStateStore();
    const out = describePaneWithState(missingRef, { store });
    expect(out.found).toBe(false);
    expect(out.description).toBeUndefined();
    expect(out.visualState).toBeDefined();
    expect(out.visualState!.focus).toBe('unfocused');
    expect(out.note).toMatch(/not resolved/);
  });

  test('store.setState → visualState reflects change even without pane', () => {
    const store = createVisualStateStore();
    store.setState(missingRef, { focusPolicy: PANE_FOCUS_POLICY.skip });
    const out = describePaneWithState(missingRef, { store });
    expect(out.visualState!.focusPolicy).toBe(PANE_FOCUS_POLICY.skip);
  });

  test('result carries ref back for LLM ack', () => {
    const store = createVisualStateStore();
    const out = describePaneWithState(missingRef, { store });
    expect(out.ref).toEqual(missingRef);
  });

  test('visibility set to hidden survives round-trip', () => {
    const store = createVisualStateStore();
    store.setState(missingRef, { visibility: PANE_VISIBILITY.hidden });
    const out = describePaneWithState(missingRef, { store });
    expect(out.visualState!.visibility).toBe(PANE_VISIBILITY.hidden);
  });
});
