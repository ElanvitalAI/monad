import { describe, expect, test } from 'bun:test';

import { createDashboardFocusTransitionState } from '../src/dashboard/input/focus-transition-state.js';

describe('dashboard focus transition state', () => {
  test('tracks pending input entry mode and supports consume semantics', () => {
    const state = createDashboardFocusTransitionState();
    expect(state.getPendingInputEntryMode()).toBeNull();
    state.setPendingInputEntryMode('plain');
    expect(state.getPendingInputEntryMode()).toBe('plain');
    expect(state.consumePendingInputEntryMode()).toBe('plain');
    expect(state.getPendingInputEntryMode()).toBeNull();
  });

  test('tracks remembered working-dir pane', () => {
    const state = createDashboardFocusTransitionState();
    expect(state.getLastWorkingDirPane()).toBeNull();
    state.setLastWorkingDirPane('browser');
    expect(state.getLastWorkingDirPane()).toBe('browser');
    state.setLastWorkingDirPane(null);
    expect(state.getLastWorkingDirPane()).toBeNull();
  });

  test('builds an apply host that mutates the same backing state', () => {
    const state = createDashboardFocusTransitionState();
    const focusCalls: string[] = [];
    const host = state.applyHost((next, reason) => focusCalls.push(`${next}:${reason}`));

    host.setLastWorkingDirPane('preview');
    host.setPendingInputEntryMode('slash');
    host.setWorkingFocus('input', 'pane-slash-open-input');

    expect(state.getLastWorkingDirPane()).toBe('preview');
    expect(state.getPendingInputEntryMode()).toBe('slash');
    expect(focusCalls).toEqual(['input:pane-slash-open-input']);
  });
});
