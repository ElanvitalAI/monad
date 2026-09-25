// ── governPhaseCapHit — cap-hit 중앙 조율(Device 3) ──
// reshape 압축 성공→reshaped·no-reshape/비압축→hitl·아크없음→hitl. resolve/executor 주입 격리.
import { test, expect, describe } from 'bun:test';
import { governPhaseCapHit } from './mission-phase-cap-governor.js';
import { createMission } from './mission-registry.js';
import { createTask } from '../task-orchestrator/types.js';

async function setupMission(arcCount: number, phaseCount: number) {
  const { TaskStore } = await import('../task-orchestrator/store.js');
  const store = new TaskStore({ path: ':memory:' });
  const m = createMission(store, { goal: '테스트 미션', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
  const ids: string[] = [];
  for (let i = 0; i < phaseCount; i++) {
    const t = createTask({ title: `phase${i}`, description: `p${i}`, surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: `p${i}` }, goalSlug: m.id, dependsOn: [], status: 'backlog', generatedBy: { kind: 'user', actorId: 'test' } }, { allowUncheckedUrgent: true, now: 1000 + i });
    store.saveTask(t); ids.push(t.id);
  }
  const arcs = arcCount > 0 ? [{ arcId: 'arc0', name: 'Arc0', intent: 'do', phaseIds: ids, splitCount: 0 }] : [];
  store.saveMission({ ...store.getMission(m.id)!, autopilot: { origin: 'manual', arcs } as any });
  return { store, m, ids };
}

describe('governPhaseCapHit', () => {
  test('★ merge-phases 로 압축 성공 → reshaped(여유 확보)', async () => {
    const { store, m, ids } = await setupMission(1, 5); // budget=5·페이즈5(cap)
    try {
      const resolve = async () => ({ action: 'merge-phases', reason: '사소 페이즈 흡수', phaseIds: [ids[0]!, ids[1]!, ids[2]!] });
      const executors = {
        mergePhases: async (_mid: string, d: any) => { for (const id of d.phaseIds.slice(1)) store.deleteTask?.(id); return { ok: true, detail: '2 흡수' }; },
        redecomposeArc: async () => ({ ok: false, error: 'n/a' }),
        carveArc: async () => ({ ok: false, error: 'n/a' }),
        maturitySplit: async () => ({ ok: false, error: 'n/a' }),
      };
      const r = await governPhaseCapHit(m.id, 'arc0', { store, resolve, executors });
      expect(r.action).toBe('reshaped');
      expect(r.reshapeAction).toBe('merge-phases');
      expect(r.freedRoom).toBe(true);
      expect(r.phaseCount).toBe(3); // 5→3 < budget 5
    } finally { store.close(); }
  });

  test('★ no-reshape 판정 → hitl(대표 결정)', async () => {
    const { store, m } = await setupMission(1, 5);
    try {
      const resolve = async () => ({ action: 'no-reshape', reason: '애매' });
      const r = await governPhaseCapHit(m.id, 'arc0', { store, resolve, executors: {} as any });
      expect(r.action).toBe('hitl');
      expect(r.freedRoom).toBe(false);
    } finally { store.close(); }
  });

  test('★ 비압축 판정(carve-arc) → hitl(증가 방향은 cap-hit 부적합)', async () => {
    const { store, m } = await setupMission(1, 5);
    try {
      const resolve = async () => ({ action: 'carve-arc', reason: '새 아크', arcId: 'arc0', phaseIds: [] });
      const r = await governPhaseCapHit(m.id, 'arc0', { store, resolve, executors: {} as any });
      expect(r.action).toBe('hitl');
      expect(r.reshapeAction).toBe('carve-arc');
    } finally { store.close(); }
  });

  test('★ 아크 구조 없음 → hitl(reshape 불가)', async () => {
    const { store, m } = await setupMission(0, 8); // arc 0·budget=floor 8
    try {
      const r = await governPhaseCapHit(m.id, undefined, { store, resolve: async () => ({ action: 'merge-phases' }), executors: {} as any });
      expect(r.action).toBe('hitl');
      expect(r.detail).toContain('아크 구조 없음');
    } finally { store.close(); }
  });

  test('★ 압축했으나 여전히 예산 초과 → hitl', async () => {
    const { store, m, ids } = await setupMission(1, 7); // budget=5·페이즈7(초과)
    try {
      const resolve = async () => ({ action: 'merge-phases', reason: '흡수', phaseIds: [ids[0]!, ids[1]!] });
      const executors = {
        mergePhases: async (_mid: string, d: any) => { for (const id of d.phaseIds.slice(1)) store.deleteTask?.(id); return { ok: true, detail: '1 흡수' }; }, // 7→6·여전히 >5
        redecomposeArc: async () => ({ ok: false, error: 'n/a' }), carveArc: async () => ({ ok: false, error: 'n/a' }), maturitySplit: async () => ({ ok: false, error: 'n/a' }),
      };
      const r = await governPhaseCapHit(m.id, 'arc0', { store, resolve, executors });
      expect(r.action).toBe('hitl');
      expect(r.phaseCount).toBe(6);
      expect(r.detail).toContain('여전히 예산 초과');
    } finally { store.close(); }
  });
});
