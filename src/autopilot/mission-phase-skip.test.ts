// ── skipPhase — 페이즈 건너뛰기(기능 제외) 탈출구(대표 2026-07-13·§5.2) ──
// 막힌 페이즈를 done+[SKIPPED] 마킹(삭제 아님)하고 dependents 를 언블록·재spawn 함을 검증.
// executor 는 dep status==='done' 일 때만 언블록하므로 done 마킹이 핵심(별도 재배선 없음).
import { test, expect, describe } from 'bun:test';
import { skipPhase } from './mission-phase-skip.js';
import { createMission } from './mission-registry.js';
import { createTask } from '../task-orchestrator/types.js';

async function setup() {
  const { TaskStore } = await import('../task-orchestrator/store.js');
  const store = new TaskStore({ path: ':memory:' });
  const m = createMission(store, { goal: 'KGS lifecycle 메타데이터', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
  const mk = (title: string, dependsOn: string[], now: number, status: 'backlog' | 'failed' = 'backlog') => {
    const t = createTask({
      title, description: title,
      surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: title },
      goalSlug: m.id, dependsOn, status,
      generatedBy: { kind: 'user', actorId: 'test' },
    }, { allowUncheckedUrgent: true, now });
    store.saveTask(t);
    return t;
  };
  const a = mk('조사', [], 1000);                    // 선행(무관)
  const p = mk('막힌 페이즈', [a.id], 1001, 'failed'); // 건너뛸 대상(실패)
  const x = mk('후속1(문서)', [p.id], 1002);          // dependent
  const y = mk('후속2(검증)', [p.id], 1003);          // dependent
  return { store, m, a, p, x, y };
}

describe('skipPhase', () => {
  test('실패 페이즈 건너뛰기 → done+[SKIPPED] 마킹(삭제 아님)·dependents 언블록 집계·재spawn', async () => {
    const { store, m, p, x, y } = await setup();
    let spawned = '';
    try {
      const r = skipPhase(m.id, p.id, { store, spawnRun: (id) => { spawned = id; }, now: () => 5000 });
      expect(r.ok).toBe(true);
      expect(r.skippedTitle).toBe('막힌 페이즈');
      expect(r.unblockedCount).toBe(2);   // x, y 두 dependent 가 언블록됨
      expect(spawned).toBe(m.id);         // 순회 재개 재spawn

      // 원본은 삭제되지 않고 done + [SKIPPED] 노트로 남는다(정직성).
      const pNow = store.listTasks({ goalSlug: m.id }).find((t) => t.id === p.id);
      expect(pNow).toBeDefined();
      expect(pNow!.status).toBe('done');
      expect(pNow!.notes.some((n) => n.includes('[SKIPPED]'))).toBe(true);

      // dependents 는 여전히 p 를 참조(재배선 안 함) — executor 가 p.done 을 dep 충족으로 봐서 언블록.
      const xNow = store.listTasks({ goalSlug: m.id }).find((t) => t.id === x.id)!;
      const yNow = store.listTasks({ goalSlug: m.id }).find((t) => t.id === y.id)!;
      expect(xNow.dependsOn).toContain(p.id);
      expect(yNow.dependsOn).toContain(p.id);
    } finally { store.close(); }
  });

  test('없는 페이즈 → ok:false(에러)', async () => {
    const { store, m } = await setup();
    try {
      const r = skipPhase(m.id, 'task:nope', { store, spawnRun: () => {} });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('페이즈 없음');
    } finally { store.close(); }
  });

  test('이미 done 인 페이즈 → ok:false(건너뛸 것 없음)', async () => {
    const { store, m, p } = await setup();
    try {
      // 먼저 done 으로 만든 뒤 다시 skip 시도.
      const first = skipPhase(m.id, p.id, { store, spawnRun: () => {} });
      expect(first.ok).toBe(true);
      const second = skipPhase(m.id, p.id, { store, spawnRun: () => {} });
      expect(second.ok).toBe(false);
      expect(second.error).toContain('이미 완료');
    } finally { store.close(); }
  });
});
