// Goal↔mission mapping (follow-up B) — the pure status mapper + the
// DualRoleManager goal exposure.

import { describe, test, expect, mock } from 'bun:test';
import { mapCodexGoalStatusToMissionStatus } from '../src/acp/codex-app-server-agent.js';
import { DualRoleManager } from '../src/acp/dual-role-manager.js';

describe('mapCodexGoalStatusToMissionStatus', () => {
  test('active / paused → running', () => {
    expect(mapCodexGoalStatusToMissionStatus('active')).toBe('running');
    expect(mapCodexGoalStatusToMissionStatus('paused')).toBe('running');
  });
  test('complete → done', () => {
    expect(mapCodexGoalStatusToMissionStatus('complete')).toBe('done');
  });
  test('blocked / usageLimited / budgetLimited → failed (needs attention)', () => {
    expect(mapCodexGoalStatusToMissionStatus('blocked')).toBe('failed');
    expect(mapCodexGoalStatusToMissionStatus('usageLimited')).toBe('failed');
    expect(mapCodexGoalStatusToMissionStatus('budgetLimited')).toBe('failed');
  });
});

function makeFakeAgent(withGoal: boolean) {
  const agent: Record<string, unknown> = {
    newSession: mock(async () => `be-${Math.random().toString(36).slice(2, 8)}`),
    prompt: mock(async () => ({ stopReason: 'end_turn' })),
    cancel: mock(async () => {}),
  };
  if (withGoal) {
    agent.setGoal = mock(async (_s: string, g: unknown) => ({ objective: (g as { objective?: string }).objective, status: 'active' }));
    agent.getGoal = mock(async () => ({ objective: 'o', status: 'complete', tokensUsed: 42 }));
  }
  return agent;
}

describe('DualRoleManager · clientSessionSetGoal / clientSessionGetGoal', () => {
  test('goal-capable backend → setGoal routed with backendSessionId + objective', async () => {
    const mgr = new DualRoleManager();
    const fake = makeFakeAgent(true);
    mgr.__setAgentFactoryForTest(async () => fake as never);
    const rec = await mgr.clientSessionCreate({ backendId: 'codex-app-server' });
    const goal = await mgr.clientSessionSetGoal({ sessionId: rec.id, objective: 'add tests', tokenBudget: 1000 });
    expect(goal).toMatchObject({ objective: 'add tests', status: 'active' });
    const setGoal = fake.setGoal as ReturnType<typeof mock>;
    const [sid, input] = setGoal.mock.calls[0] as [string, unknown];
    expect(sid).toBe(rec.backendSessionId);
    expect(input).toEqual({ objective: 'add tests', tokenBudget: 1000 });

    const read = await mgr.clientSessionGetGoal({ sessionId: rec.id });
    expect(read).toMatchObject({ status: 'complete', tokensUsed: 42 });
  });

  test('non-goal backend → null', async () => {
    const mgr = new DualRoleManager();
    mgr.__setAgentFactoryForTest(async () => makeFakeAgent(false) as never);
    const rec = await mgr.clientSessionCreate({ backendId: 'claude' });
    expect(await mgr.clientSessionSetGoal({ sessionId: rec.id, objective: 'x' })).toBeNull();
    expect(await mgr.clientSessionGetGoal({ sessionId: rec.id })).toBeNull();
  });

  test('unknown session → throws', async () => {
    const mgr = new DualRoleManager();
    await expect(mgr.clientSessionSetGoal({ sessionId: 'acp-cli:nope', objective: 'x' })).rejects.toThrow();
  });
});
