// opsMissionDetail phases[] — 저장된 진단의 툴 노출 (P1 · 2026-07-13).
// "P2 왜 실패?" 가 ops_status action:mission 1콜로 답해지는지의 계약 테스트.
// run-mission 영속(빌더)과 같은 note 포맷을 store 에 심고 읽기만 검증(재합성 없음).
import { test, expect, describe } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from '../autopilot/mission-registry.js';
import { decomposeMissionToPhases } from '../autopilot/mission-engine.js';
import { listPhases } from '../autopilot/mission-adjust.js';
import { buildDiagnosisNote, synthesizePhaseDiagnosis, type PhaseOutcome } from '../autopilot/mission-phase-diagnosis.js';
import { opsMissionDetail } from './ops-status.js';

const T = (index: number, dependsOn: number[]) => ({
  index, title: `p${index}`, description: 'd',
  surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: `p${index}` },
  dependsOn, priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['c'] },
});
const MOCK = JSON.stringify({ rationale: 'r', tasks: [T(0, []), T(1, [0]), T(2, [1])] });

async function makeFailedMission(store: TaskStore) {
  const m = createMission(store, { goal: 'heavy goal', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox', domain: 'coding' } });
  await decomposeMissionToPhases(m.id, { store, callable: async () => ({ text: MOCK, modelId: 'mock' }) });
  const phases = listPhases(store, m.id);
  // p0 done(+PR note) · p1 failed(+진단 note·run-mission 빌더와 동일 경로) · p2 backlog.
  const p0 = store.getTask(phases[0]!.id)!;
  store.saveTask({ ...p0, status: 'done', notes: [...p0.notes, '[SE-PR] https://github.com/x/y/pull/1'], updatedAt: Date.now() });
  const p1 = store.getTask(phases[1]!.id)!;
  const outcome: PhaseOutcome = {
    phaseId: p1.id, missionId: m.id, title: p1.title, index: 1, total: 3,
    status: 'failed', goal: 'heavy goal', failClass: 'budget-exhausted',
    attempts: [
      { backend: 'monad-self:gpt-5.6-terra', maxTurns: 1000, gateResult: 'gate-failed' },
      { backend: 'opus-4.8', gateResult: 'gate-failed' },
    ],
  };
  const diag = synthesizePhaseDiagnosis(outcome);
  store.saveTask({ ...p1, status: 'failed', notes: [...p1.notes, buildDiagnosisNote(diag, outcome.failClass)], updatedAt: Date.now() });
  return { m, diag };
}

describe('opsMissionDetail — phases[] + 저장 진단', () => {
  test('실패 페이즈의 failClass·rootCause·권장 힐이 1콜로 반환(저장 진단 그대로)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-phases-'));
    const store = new TaskStore({ path: join(dir, 'tasks.db') });
    try {
      const { m, diag } = await makeFailedMission(store);
      const d = opsMissionDetail(m.id, {
        missionStore: store,
        opsDbPath: join(dir, 'ops.db'),
        schedulesDbPath: join(dir, 'sched.db'),
        planDraftFor: () => join(dir, 'none.md'),
      });
      expect(d.phases.length).toBe(3);
      // seam(missionStore) 미션도 mission 필드로 해석(폴백).
      expect(d.mission?.id).toBe(m.id);
      expect(d.runLogPath).toContain('run.log');
      const failed = d.phases.find((p) => p.status === 'failed');
      expect(failed).toBeDefined();
      expect(failed!.failClass).toBe('budget-exhausted');
      expect(failed!.diagnosis).toBeDefined();
      expect(failed!.diagnosis!.rootCause).toBe(diag.rootCauseInference);
      expect(failed!.diagnosis!.heal).toBe(diag.healRecommendation.kind);
      // done 페이즈는 PR 만(진단 없음).
      const done = d.phases.find((p) => p.status === 'done');
      expect(done!.prUrl).toBe('https://github.com/x/y/pull/1');
      expect(done!.diagnosis).toBeUndefined();
      expect(d.note).toContain('진단 1');
    } finally { store.close(); }
  });

  test('진단 note 없는 미션 — phases 는 상태만(diagnosis 없음·fail-soft)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-phases2-'));
    const store = new TaskStore({ path: join(dir, 'tasks.db') });
    try {
      const m = createMission(store, { goal: 'g2', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox', domain: 'coding' } });
      await decomposeMissionToPhases(m.id, { store, callable: async () => ({ text: MOCK, modelId: 'mock' }) });
      const d = opsMissionDetail(m.id, {
        missionStore: store,
        opsDbPath: join(dir, 'ops.db'),
        schedulesDbPath: join(dir, 'sched.db'),
        planDraftFor: () => join(dir, 'none.md'),
      });
      expect(d.phases.length).toBe(3);
      expect(d.phases.every((p) => !p.diagnosis && !p.failClass)).toBe(true);
    } finally { store.close(); }
  });
});
