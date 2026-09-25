import { afterEach, describe, expect, test } from 'bun:test';
import {
  getPlanModeState, setPlanModeState, setPlanPhase, resetPlanModeState,
  subscribePlanMode, generatePlanSessionId,
  _clearPlanModeListenersForTesting,
  INACTIVE_PLAN_MODE_STATE,
} from '../../src/plan-mode/index.js';

afterEach(() => {
  resetPlanModeState();
  _clearPlanModeListenersForTesting();
});

describe('plan-mode session', () => {
  test('default state is inactive', () => {
    expect(getPlanModeState().active).toBe(false);
    expect(getPlanModeState().phase).toBe('inactive');
  });

  test('setPlanModeState flips active + phase + policy snapshot', () => {
    setPlanModeState({
      active: true, sessionId: 's1', startedAt: 1, phase: 'explore',
      planFilePath: '/tmp/plans/s1.md',
      previousPolicy: { mode: 'trusted-dirs', trustedDirs: ['/tmp'] },
    });
    const s = getPlanModeState();
    expect(s.active).toBe(true);
    expect(s.sessionId).toBe('s1');
    expect(s.previousPolicy.mode).toBe('trusted-dirs');
    expect(s.previousPolicy.trustedDirs).toEqual(['/tmp']);
  });

  test('getPlanModeState returns defensive copies', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's1', startedAt: 1, phase: 'explore',
      planFilePath: '/tmp/plans/s1.md',
      previousPolicy: { mode: 'trusted-dirs', trustedDirs: ['/a'] },
    });
    const s1 = getPlanModeState();
    s1.previousPolicy.trustedDirs?.push('/b');
    const s2 = getPlanModeState();
    expect(s2.previousPolicy.trustedDirs).toEqual(['/a']);
  });

  test('setPlanPhase is a no-op when inactive', () => {
    setPlanPhase('design');
    expect(getPlanModeState().phase).toBe('inactive');
  });

  test('setPlanPhase updates when active', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's1', startedAt: 1, phase: 'explore',
      planFilePath: '/tmp/plans/s1.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    setPlanPhase('design');
    expect(getPlanModeState().phase).toBe('design');
  });

  test('resetPlanModeState restores inactive', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's1', startedAt: 1, phase: 'explore',
      planFilePath: '/tmp/plans/s1.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    resetPlanModeState();
    expect(getPlanModeState().active).toBe(false);
  });

  test('subscribePlanMode fires on every change; dispose stops it', () => {
    const seen: boolean[] = [];
    const dispose = subscribePlanMode((s) => seen.push(s.active));
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: '/p.md', previousPolicy: { mode: 'ask-edit' },
    });
    resetPlanModeState();
    expect(seen).toEqual([true, false]);
    dispose();
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's2', startedAt: 0, phase: 'explore',
      planFilePath: '/p2.md', previousPolicy: { mode: 'ask-edit' },
    });
    expect(seen).toEqual([true, false]);
  });

  test('generatePlanSessionId produces unique ids', () => {
    const a = generatePlanSessionId();
    const b = generatePlanSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(4);
  });
});
