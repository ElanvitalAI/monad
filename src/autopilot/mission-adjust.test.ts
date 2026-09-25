// HITL 미션 조정 테스트 — trim/defer/edit + 부분 승인. 순수(무네트워크).
import { test, expect, describe } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import { decomposeMissionToPhases, approveMission } from './mission-engine.js';
import { listPhases, trimPhase, deferPhase, editPhase } from './mission-adjust.js';

const T = (index: number, dependsOn: number[]) => ({
  index, title: `p${index}`, description: 'd',
  surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: `p${index}` },
  dependsOn, priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['c'] },
});
const MOCK = JSON.stringify({ rationale: 'r', tasks: [T(0, []), T(1, [0]), T(2, [1])] });

async function makePhased(store: TaskStore) {
  const m = createMission(store, { goal: 'heavy goal', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox', domain: 'coding' } });
  await decomposeMissionToPhases(m.id, { store, callable: async () => ({ text: MOCK, modelId: 'mock' }) });
  return m;
}

describe('listPhases — index/status/deps', () => {
  test('3 페이즈·index 0-2·의존 체인', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store);
      const ph = listPhases(store, m.id);
      expect(ph.length).toBe(3);
      expect(ph[0]!.index).toBe(0);
      expect(ph[0]!.dependsOn.length).toBe(0);
      expect(ph[1]!.dependsOn).toContain(ph[0]!.id);
      expect(ph[2]!.dependsOn).toContain(ph[1]!.id);
    } finally { store.close(); }
  });
});

describe('trimPhase — 제거 + 의존자 재배선', () => {
  test('중간 페이즈 trim → 삭제 + 의존자 dependsOn 재배선', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store);
      const before = listPhases(store, m.id);
      const p1id = before[1]!.id;
      const r = trimPhase(store, m.id, 1);   // p1 제거
      expect(r.ok).toBe(true);
      expect(r.rewired).toBe(1);             // p2 가 p1 의존 → 재배선
      const after = listPhases(store, m.id);
      expect(after.length).toBe(2);
      expect(after.some((p) => p.id === p1id)).toBe(false);       // p1 사라짐
      expect(after[1]!.dependsOn).not.toContain(p1id);            // p2 의존 뗌
    } finally { store.close(); }
  });
});

describe('deferPhase — 보류(scheduled)', () => {
  test('defer → status scheduled·의존자 재배선', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store);
      const r = deferPhase(store, m.id, 1);
      expect(r.ok).toBe(true);
      const ph = listPhases(store, m.id);
      expect(ph.length).toBe(3);                                  // 삭제 아님(보류)
      expect(ph.find((p) => p.index === 1)!.status).toBe('scheduled');
    } finally { store.close(); }
  });
});

describe('editPhase(교정)', () => {
  test('제목/설명 수정', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store);
      const r = editPhase(store, m.id, 0, { title: '교정된 제목' });
      expect(r.ok).toBe(true);
      expect(listPhases(store, m.id)[0]!.title).toBe('교정된 제목');
    } finally { store.close(); }
  });
  test('실행중/완료 페이즈는 조정 불가', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store);
      // p0 을 ready 로 올려 조정 불가 확인.
      const p0 = store.listTasks({ goalSlug: m.id }).sort((a, b) => a.createdAt - b.createdAt)[0]!;
      store.saveTask({ ...p0, status: 'running' });
      const r = trimPhase(store, m.id, 0);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('조정 불가');
    } finally { store.close(); }
  });
});

describe('★ 부분 승인 — trim/defer 후 남은 페이즈만 집행', () => {
  test('p2 trim → approve 는 p0(ready)·p1(blocked)만 스테이징', async () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      const m = await makePhased(store);
      trimPhase(store, m.id, 2);   // p2 제거 → p0, p1 남음(p1 deps p0)
      const r = await approveMission(m.id, { store, spawnRun: () => {} });
      expect(r.ok).toBe(true);
      expect(r.activated).toBe(1);  // p0(root) ready
      const ph = listPhases(store, m.id).sort((a, b) => a.index - b.index);
      expect(ph.length).toBe(2);
      expect(ph[0]!.status).toBe('ready');    // p0
      expect(ph[1]!.status).toBe('blocked');  // p1(p0 의존)
    } finally { store.close(); }
  });
});
