// 미션 promote 코어 — 테스트→운영 캐스케이드 스트립/리셋/provenance 검증 (2026-07-14).
import { test, expect, describe } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import {
  buildPromotedMission, applyPromotedMission, instanceNameForStateDir,
  PROMOTE_STRIPPED_AUTOPILOT,
} from './mission-promote.js';
import type { Task } from '../task-orchestrator/types.js';

const NOW = new Date(2026, 6, 14, 9, 0, 0).getTime();

/** source 스토어에 heavy 미션 하나 + 테스트 런타임 상태(materializeSpec·runIds·paused) 심기. */
function seedSourceMission(source: TaskStore): string {
  const m = createMission(source, {
    goal: '로컬 LLM 야간 문서 정련 루프', source: 'human-intent',
    triage: { executionModel: 'task', domain: 'coding', tier: 'heavy', engine: 'tox' },
    slug: 'local-llm-nightly-doc',
  });
  // 테스트 런타임 흔적 — promote 시 스트립돼야 하는 것들.
  const mm = source.getMission(m.id)!;
  source.saveMission({
    ...mm,
    status: 'active',
    autopilot: {
      ...(mm.autopilot ?? { origin: 'human-intent' }),
      apmStatus: 'running',
      materializeSpec: { cron: '45 20 * * *', command: 'scripts/doc-night-batch.ts' },
      runIds: ['run_test_abc'],
      paused: true,
    },
  });
  return m.id;
}

function seedTaskFor(source: TaskStore, missionId: string): Task {
  const t: Task = {
    id: 'task:promote1', createdAt: NOW, updatedAt: NOW, version: 1,
    title: '위키 증분 갱신', description: '구 핸드오프에서 생존 지식 추출',
    surface: { kind: 'llm-direct', prompt: 'x' },
    missionId, dependsOn: [], priority: 'medium', isolation: 'shared',
    maxRetries: 2, attempt: 3, status: 'running', lastExecutionId: 'exec_test_xyz',
    notes: ['[ATTEMPT 3] 테스트 실행 흔적'], triggerChain: [],
  };
  source.saveTask(t);
  return t;
}

describe('buildPromotedMission — 스트립/리셋/provenance', () => {
  test('테스트 런타임 필드 스트립 + status/apmStatus 리셋 + provenance 노트', () => {
    const source = new TaskStore({ path: ':memory:' });
    const dest = new TaskStore({ path: ':memory:' });
    const id = seedSourceMission(source);

    const bundle = buildPromotedMission(source, dest, id, {
      withTasks: false, fromInstance: 'test:monad-agent', now: NOW,
    })!;

    // 스트립 확인 — materializeSpec·runIds·paused 사라짐.
    expect(bundle.mission.autopilot?.materializeSpec).toBeUndefined();
    expect(bundle.mission.autopilot?.runIds).toBeUndefined();
    expect(bundle.mission.autopilot?.paused).toBeUndefined();
    expect(bundle.stripped).toContain('materializeSpec');
    expect(bundle.stripped).toContain('runIds');
    // 착지 상태 — planning / proposed(운영 재승인).
    expect(bundle.mission.status).toBe('planning');
    expect(bundle.mission.autopilot?.apmStatus).toBe('proposed');
    // origin(source 축) 보존.
    expect(bundle.mission.autopilot?.origin).toBe('human-intent');
    // provenance 노트.
    expect(bundle.mission.notes.some((n) => n.includes('promoted from test:monad-agent'))).toBe(true);
    source.close(); dest.close();
  });

  test('--with-tasks — 파생 태스크 이관 + 런타임 리셋(attempt=0·backlog·exec 클리어)', () => {
    const source = new TaskStore({ path: ':memory:' });
    const dest = new TaskStore({ path: ':memory:' });
    const id = seedSourceMission(source);
    seedTaskFor(source, id);

    const bundle = buildPromotedMission(source, dest, id, {
      withTasks: true, fromInstance: 'test:monad-agent', now: NOW,
    })!;

    expect(bundle.tasks.length).toBe(1);
    const t = bundle.tasks[0]!;
    expect(t.status).toBe('backlog');       // running → backlog
    expect(t.attempt).toBe(0);              // 3 → 0
    expect(t.lastExecutionId).toBeUndefined();
    expect(t.missionId).toBe(id);           // 미션 연결 보존
    source.close(); dest.close();
  });

  test('goal_slug 연결 태스크도 이관 — heavy 분해 회귀 가드(2026-07-14 실측)', () => {
    const source = new TaskStore({ path: ':memory:' });
    const dest = new TaskStore({ path: ':memory:' });
    const id = seedSourceMission(source);
    // heavy 멀티페이즈 분해는 mission_id 없이 goal_slug=apm_id 로만 심는다.
    source.saveTask({
      id: 'task:phase1', createdAt: NOW, updatedAt: NOW, version: 1,
      title: '페이즈1 (goal_slug 연결)', description: '분해 산출',
      surface: { kind: 'llm-direct', prompt: 'x' },
      goalSlug: id, dependsOn: [], priority: 'medium', isolation: 'shared',
      maxRetries: 2, attempt: 0, status: 'ready', notes: [], triggerChain: [],
    });

    const bundle = buildPromotedMission(source, dest, id, {
      withTasks: true, fromInstance: 'test:x', now: NOW,
    })!;
    // mission_id 조회면 0 이었을 것 — goal_slug 유니온으로 잡아야 1.
    expect(bundle.tasks.length).toBe(1);
    expect(bundle.tasks[0]!.goalSlug).toBe(id);
    expect(bundle.tasks[0]!.status).toBe('backlog');  // ready → backlog 리셋
    source.close(); dest.close();
  });

  test('withTasks=false 면 태스크 미이관', () => {
    const source = new TaskStore({ path: ':memory:' });
    const dest = new TaskStore({ path: ':memory:' });
    const id = seedSourceMission(source);
    seedTaskFor(source, id);
    const bundle = buildPromotedMission(source, dest, id, { withTasks: false, fromInstance: 'test:x', now: NOW })!;
    expect(bundle.tasks.length).toBe(0);
    source.close(); dest.close();
  });

  test('applyPromotedMission — dest 에 착지 + 재-promote(exists) 감지', () => {
    const source = new TaskStore({ path: ':memory:' });
    const dest = new TaskStore({ path: ':memory:' });
    const id = seedSourceMission(source);
    seedTaskFor(source, id);

    const first = buildPromotedMission(source, dest, id, { withTasks: true, fromInstance: 'test:x', now: NOW })!;
    expect(first.exists).toBe(false);
    applyPromotedMission(dest, first);

    const landed = dest.getMission(id)!;
    expect(landed.status).toBe('planning');
    expect(landed.autopilot?.apmStatus).toBe('proposed');
    expect(dest.listTasksForMission(id).length).toBe(1);

    // 재-promote 는 exists=true.
    const second = buildPromotedMission(source, dest, id, { withTasks: true, fromInstance: 'test:x', now: NOW })!;
    expect(second.exists).toBe(true);
    source.close(); dest.close();
  });

  test('미션 없으면 null', () => {
    const source = new TaskStore({ path: ':memory:' });
    const dest = new TaskStore({ path: ':memory:' });
    expect(buildPromotedMission(source, dest, 'apm_nonexistent_000000', { withTasks: false, fromInstance: 'test:x', now: NOW })).toBeNull();
    source.close(); dest.close();
  });
});

describe('instanceNameForStateDir', () => {
  test('.elanous-test → test:<repo>', () => {
    expect(instanceNameForStateDir('/Users/x/source/axon/monad-agent/.elanous-test')).toBe('test:monad-agent');
  });
  test('그 외 base → test:<base>', () => {
    expect(instanceNameForStateDir('/tmp/telegram-test')).toBe('test:telegram-test');
  });
  test('스트립 목록에 계보/구체화/이력 포함', () => {
    expect(PROMOTE_STRIPPED_AUTOPILOT).toContain('materializeSpec');
    expect(PROMOTE_STRIPPED_AUTOPILOT).toContain('parentMissionId');
    expect(PROMOTE_STRIPPED_AUTOPILOT).toContain('rerunHistory');
  });
});
