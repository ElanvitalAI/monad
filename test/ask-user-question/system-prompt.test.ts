// ── Execution-mode ask-user system prompt (AU1) ──

import { describe, test, expect, afterEach } from 'bun:test';
import {
  getExecutionAskSystemPrompt,
  buildExecutionAskSystemMessages,
} from '../../src/ask-user-question/system-prompt.js';
import {
  resetPlanModeState,
  setPlanModeState,
  INACTIVE_PLAN_MODE_STATE,
} from '../../src/plan-mode/index.js';

describe('getExecutionAskSystemPrompt', () => {
  test('renders the shared ClarificationPolicy execution contract', () => {
    const p = getExecutionAskSystemPrompt();
    expect(p).toContain('shared ClarificationPolicy for the execution phase');
    expect(p).toContain('`ask`');
    expect(p).toContain('`assume`');
    expect(p).toContain('`defer`');
  });

  test('contains the 5 trigger conditions', () => {
    const p = getExecutionAskSystemPrompt();
    expect(p).toContain('Multiple valid approaches');
    expect(p).toContain('ambiguous');
    expect(p).toContain('Destructive command');
    expect(p).toContain('3+ files');
    expect(p).toContain('user preference');
  });

  test('contains the "do NOT ask" section', () => {
    const p = getExecutionAskSystemPrompt();
    expect(p).toContain('Do NOT ask');
    expect(p).toContain('should I proceed');
    expect(p).toContain('retrievable by reading files');
  });

  test('mentions the 3-question cap', () => {
    const p = getExecutionAskSystemPrompt();
    expect(p).toMatch(/3 questions|≤ 3/);
  });

  test('mentions format discipline (length caps, verbs)', () => {
    const p = getExecutionAskSystemPrompt();
    expect(p).toContain('Format discipline');
    expect(p).toMatch(/≤\s*100|100 chars/);
    expect(p).toMatch(/≤\s*20|20 chars/);
  });

  test('names AskUserQuestion by tool name', () => {
    expect(getExecutionAskSystemPrompt()).toContain('AskUserQuestion');
  });
});

describe('buildExecutionAskSystemMessages', () => {
  afterEach(() => resetPlanModeState());

  test('returns one system message when plan mode is inactive', () => {
    resetPlanModeState();
    const msgs = buildExecutionAskSystemMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('AskUserQuestion');
  });

  test('returns empty array when plan mode is active (plan prompt owns askability)', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: '/tmp/plan.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    const msgs = buildExecutionAskSystemMessages();
    expect(msgs).toEqual([]);
  });

  test('back to one message after resetPlanModeState', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: '/tmp/plan.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    resetPlanModeState();
    expect(buildExecutionAskSystemMessages().length).toBe(1);
  });
});
