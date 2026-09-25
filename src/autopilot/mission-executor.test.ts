// 승인→멀티페이즈 executor 테스트 — D6. dependsOn 스테이징 + 도메인 라우팅 + investment dry.
import { test, expect, describe } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import { decomposeMissionToPhases, approveMission } from './mission-engine.js';
import { executeApprovedMission } from './mission-executor.js';
import { promotePhasesRespectingDeps } from './domain/phase-exec.js';

const T = (index: number, dependsOn: number[]) => ({
  index, title: `p${index}`, description: 'd',
  surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: `p${index}` },
  dependsOn, priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1,
  acceptance: { criteria: ['c'] },
});
const MOCK = JSON.stringify({ rationale: 'r', tasks: [T(0, []), T(1, [0]), T(2, [1])] });

async function makePhased(store: TaskStore, domain: string) {
  const m = createMission(store, { goal: `${domain} heavy goal`, source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox', domain } });
  await decomposeMissionToPhases(m.id, { store, callable: async () => ({ text: MOCK, modelId: 'mock' }) });
  return m;
}
const sorted = (store: TaskStore, id: string) => store.listTasks({ goalSlug: id }).sort((a, b) => a.createdAt - b.createdAt);

describe('promotePhasesRespectingDeps — dependsOn 스테이징', () => {
  test('root 만 ready·나머지 blocked', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store, 'coding');
      expect(promotePhasesRespectingDeps(store, m.id, Date.now())).toBe(1);
      const t = sorted(store, m.id);
      expect(t[0]!.status).toBe('ready');    // root(deps 없음)
      expect(t[1]!.status).toBe('blocked');  // dependsOn=[0]
      expect(t[2]!.status).toBe('blocked');  // dependsOn=[1]
    } finally { store.close(); }
  });
});

describe('executeApprovedMission — 도메인 라우팅', () => {
  test('coding → root ready·deps blocked', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store, 'coding');
      const r = await executeApprovedMission(m.id, { store, now: Date.now() });
      expect(r.ok).toBe(true);
      expect(r.activated).toBe(1);
    } finally { store.close(); }
  });
  test('★ investment → 스테이징(root ready·나머지 blocked·매매는 mandate 게이트) — 대표 2026-07-13', async () => {
    // 종전 dry(activated 0·통째 차단)는 신호/구현 미션까지 막던 과잉 이중 게이트. 이제 coding 처럼
    // 스테이징. 실매매 오집행은 하위 trade-mandate(armed/live)가 게이트(도메인 통째 차단 불요).
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store, 'investment');
      const r = await executeApprovedMission(m.id, { store, now: Date.now() });
      expect(r.activated).toBe(1);
      expect(r.note).toContain('mandate');
      const t = sorted(store, m.id);
      expect(t[0]!.status).toBe('ready');
      expect(t[1]!.status).toBe('blocked');
    } finally { store.close(); }
  });
});

describe('approveMission — 멀티페이즈 라우팅(D6)', () => {
  test('coding 멀티페이즈 → deps 존중·run-mission 스폰(승인=실행 폐루프)', async () => {
    const store = new TaskStore({ path: ':memory:' });
    let spawned = false;
    try {
      const m = await makePhased(store, 'coding');
      const r = await approveMission(m.id, { store, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(true);
      expect(r.activated).toBe(1);
      // 폐루프(2026-07-12): coding 멀티페이즈 승인=실행 — run-mission 이 페이즈 인식(dependsOn
      // walk·VERDICT)으로 스테이징된 페이즈를 순회 집행한다. investment 만 dry(다음 테스트).
      // (이전 'one-shot 이 페이즈와 충돌' 가정은 페이즈 인식 러너 도입 전 근거로 무효.)
      expect(spawned).toBe(true);
      const t = sorted(store, m.id);
      expect(t[0]!.status).toBe('ready');
      expect(t[1]!.status).toBe('blocked');
    } finally { store.close(); }
  });
  test('investment 멀티페이즈 → 승인=실행(스테이징 + run-mission 스폰·매매는 mandate 게이트) — 대표 2026-07-13', async () => {
    const store = new TaskStore({ path: ':memory:' });
    let spawned = false;
    try {
      const m = await makePhased(store, 'investment');
      const r = await approveMission(m.id, { store, spawnRun: () => { spawned = true; } });
      expect(r.activated).toBe(1);
      expect(spawned).toBe(true); // ★ 투자도 승인=실행(실매매는 하위 mandate 게이트)
      const t = sorted(store, m.id);
      expect(t[0]!.status).toBe('ready');
      expect(t[1]!.status).toBe('blocked');
    } finally { store.close(); }
  });
  test('단일 페이즈 → 기존 동작(ready + run-mission 스폰)·회귀0', async () => {
    const store = new TaskStore({ path: ':memory:' });
    let spawned = false;
    try {
      const m = createMission(store, { goal: '작은 수정', source: 'human-intent', triage: { executionModel: 'task', tier: 'light', engine: 'tox', domain: 'coding' } });
      const r = await approveMission(m.id, { store, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(true);
      expect(r.activated).toBe(1);
      expect(spawned).toBe(true);   // 단일은 기존대로 스폰
    } finally { store.close(); }
  });
});
