import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordMissionDecision, formatDecision, recordMissionEdit } from './mission-decision.js';
import type { ObservationSinks } from './mission-observation.js';
import { readWorkingMemory } from './mission-working-memory.js';

let stateDir: string;
const prevEnv = process.env.MONAD_STATE_DIR;
beforeAll(() => { stateDir = mkdtempSync(join(tmpdir(), 'mdec-')); process.env.MONAD_STATE_DIR = stateDir; });
afterAll(() => { if (prevEnv === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = prevEnv; try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* noop */ } });

function spySinks() {
  const logs: Array<[string, string, unknown]> = [];
  const ops: unknown[] = [];
  const mems: unknown[] = [];
  const sinks: ObservationSinks = {
    logSink: (c, e, d) => logs.push([c, e, d]),
    opsSink: (i) => ops.push(i),
    memorySink: (i) => mems.push(i),
  };
  return { sinks, logs, ops, mems };
}

describe('recordMissionDecision — 결정 3박자 통합 창구(Layer 1)', () => {
  test('formatDecision — 누가·kind·대상·이유 한 줄', () => {
    const line = formatDecision({ kind: 're-ground', note: 'criterion 2 완화', appliesTo: 'A1 crit2', rationale: '정의모듈 한계', actor: 'operator' });
    expect(line).toBe('[operator·re-ground] [A1 crit2] criterion 2 완화 — 정의모듈 한계');
  });

  test('관측 관문 3박자 — logs.db(mission.selfheal.decision)·ops·기억 전부 흐른다', () => {
    const { sinks, logs, ops, mems } = spySinks();
    recordMissionDecision('apm_dec_test', { kind: 'defer', note: 'A3=arming HITL', appliesTo: 'A3', rationale: '매매 집행', actor: 'operator' }, sinks);
    // ① 로그 — 카테고리 mission.selfheal.decision, verdict inject
    expect(logs).toHaveLength(1);
    expect(logs[0]![0]).toBe('mission.selfheal.decision');
    expect(logs[0]![1]).toBe('inject');
    // ③ ops timeline — stateful=true
    expect(ops).toHaveLength(1);
    // ② 기억 — importance(decision=7) ≥ 6 → self-memory(surface_events) 진입
    expect(mems).toHaveLength(1);
  });

  test('워킹메모리 round-trip — provenance=decision·decisions 에 note/대상/이유', () => {
    recordMissionDecision('apm_dec_wm', { kind: 'boundary', note: 'A2까지 실체화·A3 arming', appliesTo: 'A2/A3', rationale: '매매=HITL', arcId: 'arc_x_0' }, spySinks().sinks);
    const wm = readWorkingMemory('apm_dec_wm');
    const dec = wm.find((e) => e.provenance === 'decision');
    expect(dec).toBeDefined();
    expect(dec!.decisions).toContain('A2까지 실체화·A3 arming');
    expect(dec!.decisions.some((d) => d.includes('대상: A2/A3'))).toBe(true);
    expect(dec!.decisions.some((d) => d.includes('이유: 매매=HITL'))).toBe(true);
    expect(dec!.arcId).toBe('arc_x_0');
  });

  test('reuse 결정은 재사용 경계로도 실린다(후속 페이즈 준수)', () => {
    recordMissionDecision('apm_dec_reuse', { kind: 'reuse', note: 'buildEvidenceBundle 재사용' }, spySinks().sinks);
    const wm = readWorkingMemory('apm_dec_reuse');
    const dec = wm.find((e) => e.provenance === 'decision')!;
    expect(dec.reusables).toContain('buildEvidenceBundle 재사용');
  });

  test('sink 이 던져도 관문은 fail-soft(미션 안 막음)', () => {
    const badSinks: ObservationSinks = { logSink: () => { throw new Error('boom'); }, opsSink: () => { throw new Error('boom'); }, memorySink: () => { throw new Error('boom'); } };
    expect(() => recordMissionDecision('apm_dec_fs', { kind: 'accept', note: 'x' }, badSinks)).not.toThrow();
  });
});

describe('recordMissionEdit — 구조 편집 관측 3박자', () => {
  test('편집이 logs.db(mission.selfheal.edit)·ops·기억으로 흐른다', () => {
    const { sinks, logs, ops, mems } = spySinks();
    const line = recordMissionEdit('apm_edit_test', { op: 'skip-phase', target: 'canary 라우팅', detail: '기능 제외·후속 1 언블록' }, sinks);
    expect(line).toContain('skip-phase');
    expect(logs[0]![0]).toBe('mission.selfheal.edit');
    expect(ops).toHaveLength(1); // stateful
    expect(mems).toHaveLength(1); // importance 6 ≥ 임계
  });

  test('워킹메모리 round-trip — provenance=decision·편집 요약', () => {
    recordMissionEdit('apm_edit_wm', { op: 'insert-arc', target: '리서치', detail: 'A1 뒤 삽입·2페이즈', arcId: 'arc_x_2' }, spySinks().sinks);
    const wm = readWorkingMemory('apm_edit_wm');
    const e = wm.find((x) => x.summary.includes('insert-arc'));
    expect(e).toBeDefined();
    expect(e!.arcId).toBe('arc_x_2');
  });
});
