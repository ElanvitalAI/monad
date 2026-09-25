import { describe, expect, test } from 'bun:test';
import { runSelfImplement, runProviderFields, type GoalExecutionRecord, type SelfImplementSeams } from './orchestrator.js';
import { seams } from './test-seams.js';

/**
 * ⛔⭐⭐ 종전 결손 — 원장에 「어느 두뇌로 돌았나」가 «없었다».
 * `model` 칸은 ***승격 tier 의 모델***이라 뜻이 다르고 실측 **18/628**(96% 빔)이었으며,
 * 실제 값은 `self-implement.start` ***로그에만*** 있었다(`F12`⊕`F41`).
 */
describe('runProviderFields — 순수 사상', () => {
  test('값이 있으면 옮긴다', () => {
    expect(runProviderFields({ provider: 'openai-codex', model: 'gpt-5.6', auth: 'oauth' }))
      .toEqual({ runProvider: 'openai-codex', runModel: 'gpt-5.6', runAuth: 'oauth' });
  });

  test('⛔ `unknown` 은 «칸을 안 만든다» — 「모른다」를 「값이 있다」로 세지 않는다', () => {
    expect(runProviderFields({ provider: 'unknown', model: 'unknown', auth: 'unknown' })).toEqual({});
  });

  test('⛔ 빈 문자열·공백·undefined 도 칸을 안 만든다', () => {
    expect(runProviderFields({ provider: '', model: '   ' })).toEqual({});
    expect(runProviderFields(undefined)).toEqual({});
  });

  test('일부만 알아도 «아는 것만» 남긴다', () => {
    expect(runProviderFields({ provider: 'grok', model: 'unknown' })).toEqual({ runProvider: 'grok' });
  });
});

describe('원장 record 가 실제 두뇌를 갖는다 (배선)', () => {
  test('⭐ 시작 시점 provider 가 record 에 굳는다', async () => {
    const records: GoalExecutionRecord[] = [];
    const s = seams({ gateResults: [true] });
    s.inspectActiveProvider = (() => ({ provider: 'openai-codex', model: 'gpt-5.6-terra', auth: 'oauth' })) as SelfImplementSeams['inspectActiveProvider'];
    await runSelfImplement({
      feature: 'run brain must reach the ledger',
      runId: 'run-brain-1',
      goalFile: 'docs/goals/GOAL-run-brain-probe.txt',
      writeGoalExecutionRecord: (_path, record) => { records.push(record); },
      seams: s,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      runId: 'run-brain-1',
      runProvider: 'openai-codex',
      runModel: 'gpt-5.6-terra',
      runAuth: 'oauth',
    });
    // ⛔ 그리고 «옛» `model` 칸과 갈린다 — 이 런은 tier 승격이 없으므로 그 칸은 없다
    expect('model' in records[0]!).toBe(false);
  });

  test('⛔ provider 조회가 실패해도 원장 기록을 막지 않는다', async () => {
    const records: GoalExecutionRecord[] = [];
    const s = seams({ gateResults: [true] });
    s.inspectActiveProvider = (() => { throw new Error('no provider'); }) as SelfImplementSeams['inspectActiveProvider'];
    await runSelfImplement({
      feature: 'provider inspection failure must not block the ledger',
      runId: 'run-brain-2',
      goalFile: 'docs/goals/GOAL-run-brain-probe-2.txt',
      writeGoalExecutionRecord: (_path, record) => { records.push(record); },
      seams: s,
    });
    expect(records).toHaveLength(1);
    expect('runProvider' in records[0]!).toBe(false);   // unknown 으로 접히고 칸은 안 생긴다
  });
});
