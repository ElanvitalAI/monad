// V4 자동 분해 + HITL 승인 검증 (Narrow Waist · 2026-07-09).
import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import { autoDecomposeMission, approveMission } from './mission-engine.js';

function mem(): TaskStore { return new TaskStore({ path: ':memory:' }); }

describe('V4 autoDecomposeMission', () => {
  it('scheduler 골 → backlog 태스크 + cron 추천 · 미션은 실행 안 함(proposed)', () => {
    const store = mem();
    try {
      const m = createMission(store, { goal: '매일 아침 8시 반도체 뉴스 정리', source: 'human-intent', triage: { executionModel: 'scheduler' } });
      const r = autoDecomposeMission(m.id, { store });
      expect(r.ok).toBe(true);
      expect(r.taskId).toBeTruthy();
      expect(r.inferredCron).toBeTruthy();

      const tasks = store.listTasks({ goalSlug: m.id });
      expect(tasks.length).toBe(1);
      expect(tasks[0]!.status).toBe('backlog');           // 실행 안 함 — 승인 대기
      expect(tasks[0]!.surface.kind).toBe('subagent');     // shell command 아님(안전)

      const mm = store.getMission(m.id)!;
      expect(mm.autopilot?.apmStatus ?? 'proposed').toBe('proposed');  // 미션 미실행
    } finally { store.close(); }
  });

  it('중복 분해 방지 — 이미 태스크 있으면 skip', () => {
    const store = mem();
    try {
      const m = createMission(store, { goal: '이 주제 끝까지 파봐', source: 'human-intent', triage: { executionModel: 'task' } });
      autoDecomposeMission(m.id, { store });
      const r2 = autoDecomposeMission(m.id, { store });
      expect(r2.note).toBe('이미 분해됨');
      expect(store.listTasks({ goalSlug: m.id }).length).toBe(1);
    } finally { store.close(); }
  });
});

describe('V4 approveMission (HITL)', () => {
  it('task 승인 → backlog 태스크 ready 승격 · 미션 running(active)', async () => {
    const store = mem();
    try {
      const m = createMission(store, { goal: '이 주제 끝까지 파봐', source: 'human-intent', triage: { executionModel: 'task' } });
      autoDecomposeMission(m.id, { store });
      const a = await approveMission(m.id, { store, now: 1_000_000, spawnRun: () => {} });
      expect(a.ok).toBe(true);
      expect(a.activated).toBe(1);
      expect(store.listTasks({ goalSlug: m.id })[0]!.status).toBe('ready');
      expect(store.getMission(m.id)!.status).toBe('active');   // apm running → TOX active
    } finally { store.close(); }
  });

  it('task 분해 전 승인 → lazy 자동 분해 후 집행(대표 지적 2026-07-10)', async () => {
    const store = mem();
    let spawned = '';
    try {
      // 발굴 미션처럼 backlog 없이 생성 → 승인 시 lazy 분해 후 ready 승격 + run-mission spawn.
      const m = createMission(store, { goal: 'x', source: 'discovery', triage: { executionModel: 'task' } });
      const a = await approveMission(m.id, { store, spawnRun: (id) => { spawned = id; } });
      expect(a.ok).toBe(true);
      expect(a.activated).toBe(1);
      expect(store.listTasks({ goalSlug: m.id })[0]!.status).toBe('ready');
      expect(spawned).toBe(m.id); // 실집행 spawn 호출됨
    } finally { store.close(); }
  });
});

describe('V5 approveMission scheduler (실 반복 예약)', () => {
  it('scheduler 승인 → schedule_manage create 호출(run-mission·autopilot_id)·preview 삭제·미션 running', async () => {
    const store = mem();
    try {
      const m = createMission(store, { goal: '매일 아침 8시 반도체 뉴스 정리', source: 'human-intent', triage: { executionModel: 'scheduler' } });
      autoDecomposeMission(m.id, { store });   // spec.cron 저장 + preview backlog 태스크
      expect(store.listTasks({ goalSlug: m.id }).length).toBe(1);

      const calls: Record<string, unknown>[] = [];
      const a = await approveMission(m.id, {
        store, now: 1_000_000,
        createSchedule: async (args) => { calls.push(args); return { ok: true }; },  // 실 crontab 미접촉
      });
      expect(a.ok).toBe(true);
      expect(a.scheduledCron).toBe('0 8 * * *');
      // schedule_manage create 가 run-mission 커맨드 + autopilot_id 로 호출됨.
      expect(calls.length).toBe(1);
      expect(calls[0]!.action).toBe('create');
      expect(String(calls[0]!.command)).toContain(`scripts/run-mission.ts ${m.id}`);
      expect(calls[0]!.autopilotId).toBe(m.id);
      expect(calls[0]!.cron).toBe('0 8 * * *');
      // preview 태스크는 정리되고 미션은 running(active).
      expect(store.listTasks({ goalSlug: m.id }).length).toBe(0);
      expect(store.getMission(m.id)!.status).toBe('active');
    } finally { store.close(); }
  });

  it('scheduler cron 추론 실패 시 에러(실 예약 미생성)', async () => {
    const store = mem();
    try {
      // 스케줄 단서 없는 골 → inferCronSchedule 실패.
      const m = createMission(store, { goal: 'zzz 알 수 없는 스케줄', source: 'human-intent', triage: { executionModel: 'scheduler' } });
      let called = false;
      const a = await approveMission(m.id, { store, createSchedule: async () => { called = true; return {}; } });
      expect(a.ok).toBe(false);
      expect(called).toBe(false);
    } finally { store.close(); }
  });
});
