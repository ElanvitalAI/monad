// ── rerunMission 단위테스트 — 미션 유지·페이즈 backlog 리셋·재spawn(대표 2026-07-12). ──
import { describe, it, expect } from 'bun:test';
import { rerunMission, rebuildPhase, rebuildCritiquedPhases, mergeMissionPhases } from './mission-lifecycle.js';
import { openAutopilotMissionsDb, createMission } from './mission-registry.js';
import { TaskStore } from '../task-orchestrator/store.js';
import type { Task } from '../task-orchestrator/types.js';

function phase(id: string, goalSlug: string, createdAt: number, status: Task['status'], notes: string[] = []): Task {
  return {
    id, createdAt, updatedAt: createdAt, version: 1,
    title: `phase ${id}`, description: '',
    surface: { kind: 'subagent', definitionName: 'p', prompt: 'x' },
    goalSlug, dependsOn: [], priority: 'high', isolation: 'shared', maxRetries: 2, attempt: 0,
    status, notes, triggerChain: [],
  } as Task;
}

function seed(store: TaskStore, statuses: Task['status'][]): void {
  statuses.forEach((s, i) => store.saveTask(phase(`task:p${i}`, 'm1', i + 1, s)));
}

describe('rerunMission', () => {
  it('처음부터(fromIndex 미지정) — 전 페이즈 backlog + spawn', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done', 'done', 'failed']);
      let spawned = '';
      const r = rerunMission('m1', { store, now: () => 99, spawnRun: (id) => { spawned = id; } });
      expect(r.ok).toBe(true);
      expect(r.reset).toBe(3);
      expect(r.total).toBe(3);
      expect(r.fromIndex).toBe(0);
      expect(spawned).toBe('m1');
      expect(store.listTasks({ goalSlug: 'm1' }).every((t) => t.status === 'backlog')).toBe(true);
    } finally { store.close(); }
  });

  it('특정 페이즈부터(fromIndex=1) — 그 이후만 리셋, 앞 페이즈 보존', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done', 'done', 'done']);
      let spawned = false;
      const r = rerunMission('m1', { store, fromPhaseIndex: 1, spawnRun: () => { spawned = true; } });
      expect(r.reset).toBe(2);
      expect(r.fromIndex).toBe(1);
      expect(spawned).toBe(true);
      const byId = new Map(store.listTasks({ goalSlug: 'm1' }).map((t) => [t.id, t.status]));
      expect(byId.get('task:p0')).toBe('done');     // 앞 페이즈 보존
      expect(byId.get('task:p1')).toBe('backlog');
      expect(byId.get('task:p2')).toBe('backlog');
    } finally { store.close(); }
  });

  it('이미 backlog 는 리셋 카운트 제외', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['backlog', 'done']);
      const r = rerunMission('m1', { store, spawnRun: () => {} });
      expect(r.reset).toBe(1); // done 하나만
    } finally { store.close(); }
  });

  it('페이즈 없음(단일턴/미분해) → error·spawn 안 함', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      let spawned = false;
      const r = rerunMission('m-empty', { store, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('페이즈 없음');
      expect(spawned).toBe(false);
    } finally { store.close(); }
  });

  it('fromIndex 범위 초과 → 마지막으로 클램프', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done', 'done']);
      const r = rerunMission('m1', { store, fromPhaseIndex: 99, spawnRun: () => {} });
      expect(r.fromIndex).toBe(1);
      expect(r.reset).toBe(1);
    } finally { store.close(); }
  });
});

describe('재실행 히스토리 보관 + 세대 (대표 2026-07-12)', () => {
  it('리셋 직전 페이즈 상태를 세대 스냅샷으로 보관하고 세대 +1', () => {
    const store = openAutopilotMissionsDb(':memory:');
    try {
      const m = createMission(store, { goal: '기억 생애주기', source: 'human-intent', status: 'running', triage: { executionModel: 'pipeline' } });
      store.saveTask(phase('task:p0', m.id, 1, 'done', ['[SE·PR] PR 초안 https://github.com/o/r/pull/1']));
      store.saveTask(phase('task:p1', m.id, 2, 'failed', ['조사 미완료']));

      const r = rerunMission(m.id, { store, now: () => 5000, spawnRun: () => {} });
      expect(r.ok).toBe(true);
      expect(r.generation).toBe(1); // 최초(0) → 재실행 후 1

      const saved = store.getMission(m.id);
      expect(saved?.autopilot?.rerunGeneration).toBe(1);
      const hist = saved?.autopilot?.rerunHistory ?? [];
      expect(hist.length).toBe(1);
      expect(hist[0]!.generation).toBe(0);       // 보관된 건 직전 세대(0)
      expect(hist[0]!.reason).toBe('rerun');
      expect(hist[0]!.phases.map((p) => p.status)).toEqual(['done', 'failed']);
      expect(hist[0]!.phases[0]!.prUrl).toBe('https://github.com/o/r/pull/1'); // PR 보존
    } finally { store.close(); }
  });

  it('두 번 재실행 → 세대 2 · 히스토리 2건 누적(이전 시도 증발 안 함)', () => {
    const store = openAutopilotMissionsDb(':memory:');
    try {
      const m = createMission(store, { goal: 'g', source: 'human-intent', status: 'running', triage: { executionModel: 'pipeline' } });
      store.saveTask(phase('task:p0', m.id, 1, 'done'));

      rerunMission(m.id, { store, now: () => 100, spawnRun: () => {} });
      rerunMission(m.id, { store, now: () => 200, spawnRun: () => {} });

      const saved = store.getMission(m.id);
      expect(saved?.autopilot?.rerunGeneration).toBe(2);
      expect((saved?.autopilot?.rerunHistory ?? []).map((h) => h.generation)).toEqual([0, 1]);
    } finally { store.close(); }
  });

  it('★ 이전 세대 SE PR 자동 롤백(대표 2026-07-12) — 리셋 전 [SE-PR] close', () => {
    const store = openAutopilotMissionsDb(':memory:');
    try {
      const m = createMission(store, { goal: 'g', source: 'human-intent', status: 'running', triage: { executionModel: 'pipeline' } });
      store.saveTask(phase('task:p0', m.id, 1, 'done', ['[SE-PR] https://github.com/o/r/pull/3884']));
      store.saveTask(phase('task:p1', m.id, 2, 'done', ['[SE-PR] https://github.com/o/r/pull/3885']));

      const closed: string[] = [];
      const r = rerunMission(m.id, { store, now: () => 1, spawnRun: () => {}, closePr: (u) => { closed.push(u); return true; } });
      expect(r.ok).toBe(true);
      // 두 페이즈의 이전 PR 이 자동 close(롤백)됨.
      expect(closed.sort()).toEqual([
        'https://github.com/o/r/pull/3884',
        'https://github.com/o/r/pull/3885',
      ]);
    } finally { store.close(); }
  });

  it('fromPhaseIndex 이후 페이즈의 PR 만 롤백(앞 페이즈 PR 보존)', () => {
    const store = openAutopilotMissionsDb(':memory:');
    try {
      const m = createMission(store, { goal: 'g', source: 'human-intent', status: 'running', triage: { executionModel: 'pipeline' } });
      store.saveTask(phase('task:p0', m.id, 1, 'done', ['[SE-PR] https://github.com/o/r/pull/1']));
      store.saveTask(phase('task:p1', m.id, 2, 'done', ['[SE-PR] https://github.com/o/r/pull/2']));

      const closed: string[] = [];
      rerunMission(m.id, { store, fromPhaseIndex: 1, spawnRun: () => {}, closePr: (u) => { closed.push(u); return true; } });
      expect(closed).toEqual(['https://github.com/o/r/pull/2']); // p1 만·p0 보존
    } finally { store.close(); }
  });

  it('깨끗한 리셋 — 실행 잔재 notes 제거·[REBUILD] 지적 보존', () => {
    const store = openAutopilotMissionsDb(':memory:');
    try {
      const m = createMission(store, { goal: 'g', source: 'human-intent', status: 'running', triage: { executionModel: 'pipeline' } });
      store.saveTask(phase('task:p0', m.id, 1, 'failed', ['[ATTEMPT 1] 실패', '[REBUILD] 범위 밖 금지', '원본 컨텍스트']));

      rerunMission(m.id, { store, now: () => 100, spawnRun: () => {} });

      const t = store.listTasks({ goalSlug: m.id }).find((x) => x.id === 'task:p0');
      expect(t?.status).toBe('backlog');
      expect(t?.notes).toEqual(['[REBUILD] 범위 밖 금지', '원본 컨텍스트']); // 잔재 제거·지적/원본 보존
    } finally { store.close(); }
  });
});

describe('중복 실행 가드 (Phase 2·대표 2026-07-12)', () => {
  it('이미 실행 중이면 리셋·spawn 없이 거부(진행 세대 오염 방지)', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done', 'failed']);
      let spawned = false;
      const r = rerunMission('m1', { store, isRunning: () => true, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('이미 실행 중');
      expect(spawned).toBe(false);
      // 페이즈 status 그대로(리셋 안 됨).
      const byId = new Map(store.listTasks({ goalSlug: 'm1' }).map((t) => [t.id, t.status]));
      expect(byId.get('task:p0')).toBe('done');
      expect(byId.get('task:p1')).toBe('failed');
    } finally { store.close(); }
  });

  it('실행 중 아니면 정상 진행', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done']);
      let spawned = false;
      const r = rerunMission('m1', { store, isRunning: () => false, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(true);
      expect(spawned).toBe(true);
    } finally { store.close(); }
  });
});

describe('rebuildCritiquedPhases — 비평 재반영(대표 2026-07-12·지적된 것만)', () => {
  it('비평 있는 페이즈만 backlog 리셋·[REBUILD] 승격·PR 유지(재활용), clean 페이즈는 done 유지', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      // p0 clean(done 유지), p1 비평 FAIL(재구현), p2 clean(done 유지).
      store.saveTask(phase('task:p0', 'm1', 1, 'done', ['[SE-PR] https://github.com/o/r/pull/1']));
      store.saveTask(phase('task:p1', 'm1', 2, 'done', ['[SE-PR] https://github.com/o/r/pull/2', '[CRITIQUE:FAIL] 범위밖 apps/pwa/out']));
      store.saveTask(phase('task:p2', 'm1', 3, 'done', ['[SE-PR] https://github.com/o/r/pull/3']));

      let spawned = false;
      const r = rebuildCritiquedPhases('m1', { store, isRunning: () => false, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(true);
      expect(r.rebuilt).toBe(1);
      expect(r.phases).toEqual(['phase task:p1']);
      expect(spawned).toBe(true);

      const byId = new Map(store.listTasks({ goalSlug: 'm1' }).map((t) => [t.id, t]));
      expect(byId.get('task:p0')!.status).toBe('done'); // clean 유지
      expect(byId.get('task:p2')!.status).toBe('done'); // clean 유지
      expect(byId.get('task:p1')!.status).toBe('backlog'); // 재구현 대상만 리셋
      expect(byId.get('task:p1')!.notes.some((n) => n.includes('[REBUILD] (자동 비평) 범위밖 apps/pwa/out'))).toBe(true);
      // ★ PR 은 닫지 않음(재활용) — upsertPr 가 같은 브랜치 force-push 로 기존 PR 자동 업데이트.
    } finally { store.close(); }
  });

  it('비평 있는 페이즈 없으면 error(전부 clean)', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      store.saveTask(phase('task:p0', 'm1', 1, 'done', ['[SE-PR] https://github.com/o/r/pull/1']));
      const r = rebuildCritiquedPhases('m1', { store, isRunning: () => false, spawnRun: () => {} });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('clean');
    } finally { store.close(); }
  });

  it('이미 실행 중이면 거부', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      store.saveTask(phase('task:p0', 'm1', 1, 'done', ['[CRITIQUE:FAIL] x']));
      const r = rebuildCritiquedPhases('m1', { store, isRunning: () => true, spawnRun: () => {} });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('이미 실행 중');
    } finally { store.close(); }
  });
});

describe('mergeMissionPhases — clean PR 반영(머지·대표 2026-07-12)', () => {
  it('비평 clean PR 만 머지, 비평 지적 PR 은 skip(재반영 먼저)', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      store.saveTask(phase('task:p0', 'm1', 1, 'done', ['[SE-PR] https://github.com/o/r/pull/1'])); // clean
      store.saveTask(phase('task:p1', 'm1', 2, 'done', ['[SE-PR] https://github.com/o/r/pull/2', '[CRITIQUE:FAIL] 범위밖'])); // 지적
      store.saveTask(phase('task:p2', 'm1', 3, 'done', ['[SE-PR] https://github.com/o/r/pull/3'])); // clean

      const merged: string[] = [];
      const r = mergeMissionPhases('m1', { store, mergePr: (u) => { merged.push(u); return true; } });
      expect(r.ok).toBe(true);
      expect(r.merged).toBe(2); // clean 2개만
      expect(merged.sort()).toEqual(['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/3']);
      // 비평 지적 PR #2 는 머지 안 함.
      expect(merged).not.toContain('https://github.com/o/r/pull/2');
    } finally { store.close(); }
  });

  it('머지할 clean PR 없으면 error', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      store.saveTask(phase('task:p0', 'm1', 1, 'done', ['[SE-PR] https://github.com/o/r/pull/2', '[CRITIQUE:WARN] x']));
      const r = mergeMissionPhases('m1', { store, mergePr: () => true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('clean PR 없음');
    } finally { store.close(); }
  });
});

describe('rebuildPhase (R3)', () => {
  it('특정 페이즈부터 재구현 + [REBUILD] note 기록', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done', 'done', 'done']);
      let spawned = false;
      const r = rebuildPhase('m1', 'task:p1', { store, note: '기존 모듈 확장으로 고쳐', spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(true);
      expect(r.fromIndex).toBe(1);      // p1 부터
      expect(spawned).toBe(true);
      const t = store.listTasks({ goalSlug: 'm1' }).find((x) => x.id === 'task:p1');
      expect(t?.notes.some((n) => n.startsWith('[REBUILD]'))).toBe(true);
      expect(store.listTasks({ goalSlug: 'm1' }).find((x) => x.id === 'task:p0')?.status).toBe('done'); // 앞 보존
    } finally { store.close(); }
  });

  it('없는 페이즈 → error·spawn 안 함', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      seed(store, ['done']);
      let spawned = false;
      const r = rebuildPhase('m1', 'task:zzz', { store, spawnRun: () => { spawned = true; } });
      expect(r.ok).toBe(false);
      expect(spawned).toBe(false);
    } finally { store.close(); }
  });

  it('★ 보관된 [CRITIQUE] 지적을 [REBUILD] 로 승격 — 재구현이 비평 반영(대표 2026-07-12)', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      // 빌드 결과로 executor 가 심은 비평 지적(범위밖·마이그레이션)을 가진 페이즈.
      store.saveTask(phase('task:p0', 'm1', 1, 'done', [
        '[SE-PR] https://github.com/o/r/pull/3884',
        '[CRITIQUE:FAIL] 범위밖 변경 1건: apps/pwa/out',
        '[CRITIQUE:FAIL] ALTER TABLE 마이그레이션 누락 — 기존 DB 업그레이드 미보장',
      ]));
      const r = rebuildPhase('m1', 'task:p0', { store, note: '사람 재구현 요청', spawnRun: () => {} });
      expect(r.ok).toBe(true);
      const t = store.listTasks({ goalSlug: 'm1' }).find((x) => x.id === 'task:p0');
      const rebuilds = (t?.notes ?? []).filter((n) => n.startsWith('[REBUILD]'));
      // 사람 요청 1 + 비평 2건 = [REBUILD] 3건. SE 가 writePhasePlan 에서 전부 반영.
      expect(rebuilds.length).toBe(3);
      expect(rebuilds.some((n) => n.includes('apps/pwa/out'))).toBe(true);
      expect(rebuilds.some((n) => n.includes('ALTER TABLE'))).toBe(true);
    } finally { store.close(); }
  });

  it('비평 없이 재구현 → 사람 note 만 [REBUILD]', () => {
    const store = new TaskStore({ path: ':memory:' });
    try {
      store.saveTask(phase('task:p0', 'm1', 1, 'done', ['[SE-PR] https://github.com/o/r/pull/9']));
      rebuildPhase('m1', 'task:p0', { store, note: '다시 해줘', spawnRun: () => {} });
      const t = store.listTasks({ goalSlug: 'm1' }).find((x) => x.id === 'task:p0');
      const rebuilds = (t?.notes ?? []).filter((n) => n.startsWith('[REBUILD]'));
      expect(rebuilds).toEqual(['[REBUILD] 다시 해줘']);
    } finally { store.close(); }
  });
});
