import { describe, expect, test } from 'bun:test';

import {
  armDashboardAcpTurnRef,
  createDashboardAcpTurnRef,
  finalizeDashboardStreamLifecycle,
  resetDashboardAcpTurnRef,
} from '../src/dashboard/turn-lifecycle-runtime.js';

describe('dashboard acp turn ref lifecycle', () => {
  test('arms and resets the per-turn ref', () => {
    const ref = createDashboardAcpTurnRef();
    const abortCtrl = new AbortController();
    armDashboardAcpTurnRef(ref, {
      abortCtrl,
      userText: '개발 하니스로 이 버그를 고쳐줘',
      turnProfile: { surface: 'dashboard' } as any,
      searchPlannerState: {} as any,
      optionalSpecs: [{ name: 'tool' } as any],
    });
    expect(ref.abortCtrl).toBe(abortCtrl);
    expect(ref.userText).toBe('개발 하니스로 이 버그를 고쳐줘');
    expect(ref.turnProfile).toEqual({ surface: 'dashboard' });
    expect(ref.optionalSpecs).toHaveLength(1);

    resetDashboardAcpTurnRef(ref);
    expect(ref).toEqual({
      abortCtrl: null,
      userText: null,
      turnProfile: null,
      searchPlannerState: null,
      optionalSpecs: [],
    });
  });
});

describe('finalizeDashboardStreamLifecycle', () => {
  test('cleans up esc wiring and preserves completed status', () => {
    const calls: string[] = [];
    const next = finalizeDashboardStreamLifecycle(
      () => { calls.push('cleanup'); },
      false,
      'completed',
    );
    expect(next).toBe('completed');
    expect(calls).toEqual(['cleanup']);
  });

  test('promotes aborted streams to interrupted', () => {
    const next = finalizeDashboardStreamLifecycle(
      () => {},
      true,
      'completed',
    );
    expect(next).toBe('interrupted');
  });
});
