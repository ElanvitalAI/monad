import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildPlanModeSystemPrompt, buildPlanModeSystemMessages,
  setPlanModeState, resetPlanModeState, INACTIVE_PLAN_MODE_STATE,
} from '../../src/plan-mode/index.js';

afterEach(() => resetPlanModeState());

describe('buildPlanModeSystemPrompt', () => {
  test('returns empty when plan mode is inactive', () => {
    expect(buildPlanModeSystemPrompt(INACTIVE_PLAN_MODE_STATE)).toBe('');
  });

  test('returns the template with {PLAN_FILE_PATH} substituted', () => {
    const state = {
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore' as const,
      planFilePath: '/abs/plans/s.md',
      previousPolicy: { mode: 'ask-edit' as const },
    };
    const text = buildPlanModeSystemPrompt(state);
    expect(text).toContain('/abs/plans/s.md');
    expect(text).not.toContain('{PLAN_FILE_PATH}');
    expect(text).toContain('Plan mode is ACTIVE');
    expect(text).toContain('Explore');
    expect(text).toContain('ExitPlanMode');
  });

  test('template includes all 4 phase names', () => {
    const state = {
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore' as const,
      planFilePath: '/a.md', previousPolicy: { mode: 'ask-edit' as const },
    };
    const text = buildPlanModeSystemPrompt(state);
    for (const phase of ['Explore', 'Intent', 'Design', 'Finalize']) {
      expect(text).toContain(phase);
    }
  });

  test('forbids update_plan + "should I proceed?"', () => {
    const state = {
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore' as const,
      planFilePath: '/a.md', previousPolicy: { mode: 'ask-edit' as const },
    };
    const text = buildPlanModeSystemPrompt(state);
    expect(text).toContain('update_plan');
    expect(text).toContain('should I proceed?');
  });
});

describe('buildPlanModeSystemMessages', () => {
  test('returns [] when plan mode is inactive', () => {
    expect(buildPlanModeSystemMessages()).toEqual([]);
  });

  test('returns a single system message when plan mode is active', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: '/p.md', previousPolicy: { mode: 'ask-edit' },
    });
    const msgs = buildPlanModeSystemMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('/p.md');
  });
});
