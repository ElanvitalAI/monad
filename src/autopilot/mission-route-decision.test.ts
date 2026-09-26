import { describe, expect, test } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createTask } from '../task-orchestrator/types.js';
import { formatRouteDecisionNote, latestMissionRouteDecision, parseRouteDecisionNote, persistMissionRouteDecision, routeDecisionFromExecutionBackend } from './mission-route-decision.js';

const decision = { provider: 'openai-codex' as const, model: 'gpt-5.6-terra', effort: 'low' as const, source: 'codex-tier-policy' as const, rationale: 'Codex-first build: terra coding tier', mission: 'build' as const };

describe('mission route-decision evidence', () => {
  test('serializes safely and rejects malformed notes', () => {
    expect(parseRouteDecisionNote(formatRouteDecisionNote(decision))).toMatchObject(decision);
    expect(parseRouteDecisionNote('[ROUTE-DECISION] nope')).toBeNull();
  });

  test('adapter backend becomes concrete execution evidence', () => {
    expect(routeDecisionFromExecutionBackend('elanous-self:claude-opus-4-8')).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-8', source: 'execution-backend' });
  });

  test('replaces phase evidence and briefing reader gets the latest phase', () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    try {
      const task = createTask({ title: '구현', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: '구현' } }, { id: 'task:r3', now: 1 });
      task.goalSlug = 'apm_r3';
      store.saveTask(task);
      persistMissionRouteDecision(task.id, decision, { store });
      persistMissionRouteDecision(task.id, { ...decision, model: 'gpt-5.6-sol', mission: 'review' }, { store });
      expect(latestMissionRouteDecision('apm_r3', { store })).toMatchObject({ model: 'gpt-5.6-sol', mission: 'review' });
      expect(store.getTask(task.id)!.notes.filter((n) => n.startsWith('[ROUTE-DECISION]'))).toHaveLength(1);
    } finally { store.close(); }
  });
});
