// ── PFC-S2 T3: Conductor ToolRuntime registration ──

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  ALL_CONDUCTOR_RUNTIMES,
  classifyGoalRuntime,
} from '../src/tool-runtime/conductor-runtimes';
import {
  dispatchToolByName,
  getToolRuntime,
  registerToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';

describe('Conductor runtime registration', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
  });

  test('ALL_CONDUCTOR_RUNTIMES has 1 unique id', () => {
    expect(ALL_CONDUCTOR_RUNTIMES.length).toBe(1);
    expect(ALL_CONDUCTOR_RUNTIMES[0]!.id).toBe('classify_goal');
    expect(classifyGoalRuntime.spec.name).toBe('ClassifyGoal');
  });

  test('registration is idempotent', () => {
    for (const rt of ALL_CONDUCTOR_RUNTIMES) registerToolRuntime(rt);
    for (const rt of ALL_CONDUCTOR_RUNTIMES) registerToolRuntime(rt);
    expect(getToolRuntime('classify_goal')).toBeDefined();
  });

  test('dispatchToolByName routes end-to-end', async () => {
    for (const rt of ALL_CONDUCTOR_RUNTIMES) registerToolRuntime(rt);
    const r = await dispatchToolByName(
      'classify_goal',
      { intake: '분석 report 작성' },
      { surface: 'skill' },
    );
    expect((r as any).kind).toBe('research');
    expect((r as any).routed_adapter).toBe('research');
  });
});
