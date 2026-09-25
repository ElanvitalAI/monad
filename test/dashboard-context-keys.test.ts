// IDX-2b — dashboard-level singleton ContextKeyService.
//
// Covers: lazy init, identity between calls, reset for tests,
// convenience helpers.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getDashboardContextKeyService,
  getDashboardContextKeys,
  updateDashboardContextKeys,
  __resetDashboardContextKeysForTests,
} from '../src/dashboard/context/keys.js';

beforeEach(() => { __resetDashboardContextKeysForTests(); });
afterEach(() => { __resetDashboardContextKeysForTests(); });

describe('dashboard-context-keys singleton', () => {
  test('returns the same service instance across calls', () => {
    const a = getDashboardContextKeyService();
    const b = getDashboardContextKeyService();
    expect(a).toBe(b);
  });

  test('initial snapshot equals INITIAL_CONTEXT_KEYS', () => {
    const svc = getDashboardContextKeyService();
    expect(svc.keys.focusMode).toBe('pane');
    expect(svc.keys.pickerOpen).toBe(false);
    expect(svc.keys.autoModeActive).toBe(false);
    expect(svc.keys.modalTopTier).toBeNull();
  });

  test('getDashboardContextKeys returns the keys snapshot', () => {
    const svc = getDashboardContextKeyService();
    const keys1 = getDashboardContextKeys();
    expect(keys1).toBe(svc.keys);

    svc.update({ pickerOpen: true });
    const keys2 = getDashboardContextKeys();
    expect(keys2.pickerOpen).toBe(true);
    expect(keys2).not.toBe(keys1);   // new frozen object
  });

  test('updateDashboardContextKeys merges into singleton', () => {
    updateDashboardContextKeys({ focusMode: 'input', activePaneId: 'browser' });
    const keys = getDashboardContextKeys();
    expect(keys.focusMode).toBe('input');
    expect(keys.activePaneId).toBe('browser');
  });

  test('reset helper produces a fresh service after call', () => {
    const before = getDashboardContextKeyService();
    before.update({ pickerOpen: true });
    expect(before.keys.pickerOpen).toBe(true);

    __resetDashboardContextKeysForTests();

    const after = getDashboardContextKeyService();
    expect(after).not.toBe(before);
    expect(after.keys.pickerOpen).toBe(false);
  });

  test('subscribers fire on update', () => {
    const svc = getDashboardContextKeyService();
    let fires = 0;
    svc.subscribe(() => { fires++; });
    // prime fire = 1
    updateDashboardContextKeys({ focusMode: 'input' });
    expect(fires).toBe(2);
  });
});
