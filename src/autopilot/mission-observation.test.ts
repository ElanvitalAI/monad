import { describe, it, expect } from 'bun:test';
import {
  recordMissionObservation,
  makeMissionObserver,
  SELF_MEMORY_IMPORTANCE,
  type SelfHealEvent,
  type ObservationSinks,
} from './mission-observation.js';

/** 관문의 3박자 팬아웃을 spy sink 로 관측(실 debug.log/ops/self-memory 무접촉). */
function spySinks() {
  const logs: Array<{ category: string; event: string; data: unknown }> = [];
  const ops: unknown[] = [];
  const mem: unknown[] = [];
  const sinks: ObservationSinks = {
    logSink: (category, event, data) => logs.push({ category, event, data }),
    opsSink: (input) => ops.push(input),
    memorySink: (input) => mem.push(input),
  };
  return { logs, ops, mem, sinks };
}

const base: Omit<SelfHealEvent, 'stage'> = {
  missionId: 'apm_test_abc',
  phaseId: 'task:phase1',
  phaseTitle: '관측 envelope 정의',
  rationale: 'grounded 미충족',
};

describe('recordMissionObservation — 3박자 팬아웃', () => {
  it('로그는 항상 흐른다 (카테고리 규약 mission.selfheal.<stage>)', () => {
    const { logs, sinks } = spySinks();
    recordMissionObservation({ ...base, stage: 'prevent', verdict: 'inject' }, sinks);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.category).toBe('mission.selfheal.prevent');
    expect(logs[0]!.event).toBe('inject');
    const data = logs[0]!.data as Record<string, unknown>;
    expect(data.missionId).toBe('apm_test_abc');
    expect(data.phaseId).toBe('task:phase1');
    expect(data.rationale).toBe('grounded 미충족');
  });

  it('중대(importance>=임계)면 self-memory 로 흐른다 — 교착(deadlock 기본 7)', () => {
    const { mem, sinks } = spySinks();
    recordMissionObservation({ ...base, stage: 'deadlock', verdict: 'stuck', missing: 'validate 없음' }, sinks);
    expect(mem).toHaveLength(1);
    const m = mem[0] as Record<string, unknown>;
    expect(m.tool).toBe('autopilot');
    expect(m.kind).toBe('mission-selfheal');
    expect(m.importance).toBe(7);
    expect(String(m.text)).toContain('validate 없음');
  });

  it('경미(importance<임계)면 self-memory 안 흐른다 — 예방(prevent 기본 4)', () => {
    const { mem, sinks } = spySinks();
    recordMissionObservation({ ...base, stage: 'prevent', verdict: 'inject' }, sinks);
    expect(mem).toHaveLength(0);
  });

  it('importance 명시가 stage 기본값을 오버라이드한다', () => {
    const { mem, sinks } = spySinks();
    recordMissionObservation({ ...base, stage: 'prevent', importance: SELF_MEMORY_IMPORTANCE }, sinks);
    expect(mem).toHaveLength(1);
  });

  it('stateful 이면 ops_events(운영전이)로 흐른다', () => {
    const { ops, sinks } = spySinks();
    recordMissionObservation({ ...base, stage: 'deadlock', verdict: 'stuck', stateful: true }, sinks);
    expect(ops).toHaveLength(1);
    const o = ops[0] as Record<string, unknown>;
    expect(o.entityType).toBe('task');
    expect(o.entityId).toBe('task:phase1');
    expect(o.event).toBe('status_change');
    expect(String(o.rationale)).toContain('selfheal:deadlock');
  });

  it('stateful 아니면 ops_events 안 흐른다', () => {
    const { ops, sinks } = spySinks();
    recordMissionObservation({ ...base, stage: 'diagnose', verdict: 'pass' }, sinks);
    expect(ops).toHaveLength(0);
  });

  it('triageKind·refs 가 payload 에 실린다', () => {
    const { logs, sinks } = spySinks();
    recordMissionObservation(
      { ...base, stage: 'triage', verdict: 'fail', triageKind: 'revise', refs: { buildId: 'b_1', backend: 'opus' } },
      sinks,
    );
    const data = logs[0]!.data as Record<string, unknown>;
    expect(data.triageKind).toBe('revise');
    expect((data.refs as Record<string, unknown>).buildId).toBe('b_1');
  });
});

describe('recordMissionObservation — fail-soft', () => {
  it('어떤 sink 가 던져도 관문은 던지지 않는다', () => {
    const throwing: ObservationSinks = {
      logSink: () => { throw new Error('log boom'); },
      opsSink: () => { throw new Error('ops boom'); },
      memorySink: () => { throw new Error('mem boom'); },
    };
    expect(() =>
      recordMissionObservation({ ...base, stage: 'deadlock', verdict: 'stuck', stateful: true }, throwing),
    ).not.toThrow();
  });

  it('로그 sink 가 던져도 나머지 sink 는 계속 흐른다', () => {
    const ops: unknown[] = [];
    const mem: unknown[] = [];
    const partial: ObservationSinks = {
      logSink: () => { throw new Error('log boom'); },
      opsSink: (i) => ops.push(i),
      memorySink: (i) => mem.push(i),
    };
    recordMissionObservation({ ...base, stage: 'deadlock', verdict: 'stuck', stateful: true }, partial);
    expect(ops).toHaveLength(1);
    expect(mem).toHaveLength(1);
  });
});

describe('makeMissionObserver — 컨텍스트 바인딩', () => {
  it('missionId·phaseId·phaseTitle 을 반복 없이 바인딩한다', () => {
    const { logs, mem, sinks } = spySinks();
    const observe = makeMissionObserver(
      { missionId: 'apm_x', phaseId: 'task:p2', phaseTitle: '국면 관측' },
      sinks,
    );
    observe({ stage: 'recover', verdict: 'no-op', rationale: '리커버리도 변경 0', importance: 6 });
    expect(logs[0]!.category).toBe('mission.selfheal.recover');
    const data = logs[0]!.data as Record<string, unknown>;
    expect(data.missionId).toBe('apm_x');
    expect(data.phaseId).toBe('task:p2');
    expect(data.phaseTitle).toBe('국면 관측');
    expect(mem).toHaveLength(1);
  });
});
