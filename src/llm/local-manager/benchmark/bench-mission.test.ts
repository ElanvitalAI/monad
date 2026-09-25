import { describe, it, expect } from 'bun:test';
import { runLocalBenchMission } from './bench-mission.js';
import type { Scorecard } from './runner.js';

const sc = (model: string, total: number, saturated = false): Scorecard => ({
  target: { node: 'node-b', model, endpoint: 'http://node-b:1234' },
  total, max: 100,
  byCategory: { coding: { score: 0, max: 50 }, reasoning: { score: 0, max: 30 }, rag: { score: 0, max: 10 }, 'kr-format': { score: 0, max: 10 } },
  tasks: [], warmupMs: 0, totalMs: 0, startedAt: 0, saturated,
});

const fleet = ['gemma', 'qwen', 'nemo'];

describe('runLocalBenchMission — preset 역제안(비파괴·HITL)', () => {
  it('preset 미설정 → 1위를 후보로 제안', async () => {
    const r = await runLocalBenchMission({
      listModels: async () => fleet,
      benchmark: async () => [sc('gemma', 90), sc('qwen', 70), sc('nemo', 84)],
    });
    expect(r.proposal?.kind).toBe('preset-recommendation');
    expect(r.proposal?.top.model).toBe('gemma');
    expect(r.proposal?.promote).toBe(false);
    expect(r.proposal?.ranking.map((x) => x.model)).toEqual(['gemma', 'nemo', 'qwen']);
  });

  it('현재 preset 이 1위면 제안 없음(noop)', async () => {
    const r = await runLocalBenchMission({
      listModels: async () => fleet,
      benchmark: async () => [sc('gemma', 90), sc('qwen', 70)],
      currentPreset: () => 'gemma',
    });
    expect(r.proposal).toBeUndefined();
  });

  it('마진 미만 우위면 제안 안 함(노이즈 억제)', async () => {
    const r = await runLocalBenchMission({
      listModels: async () => fleet,
      benchmark: async () => [sc('qwen', 86), sc('gemma', 84)],
      currentPreset: () => 'gemma', proposeMargin: 3,
    });
    expect(r.proposal).toBeUndefined(); // 86-84=2 < 3
  });

  it('마진 이상 앞서면 교체 제안 + onProposal 호출', async () => {
    let got: unknown = null;
    const r = await runLocalBenchMission({
      listModels: async () => fleet,
      benchmark: async () => [sc('qwen', 92), sc('gemma', 84)],
      currentPreset: () => 'gemma', proposeMargin: 3,
      onProposal: (p) => { got = p; },
    });
    expect(r.proposal?.top.model).toBe('qwen');
    expect(r.proposal?.current?.model).toBe('gemma');
    expect(got).not.toBeNull();
  });

  it('전 모델 포화 → allSaturated + rationale 경고', async () => {
    const r = await runLocalBenchMission({
      listModels: async () => fleet,
      benchmark: async () => [sc('gemma', 100, true), sc('qwen', 96, true)],
      currentPreset: () => 'zzz-old',
    });
    expect(r.proposal?.allSaturated).toBe(true);
    expect(r.proposal?.rationale).toContain('포화');
  });

  it('모델 없음 → 스킵(제안 없음)', async () => {
    const r = await runLocalBenchMission({ listModels: async () => [], benchmark: async () => [] });
    expect(r.scorecards).toHaveLength(0);
    expect(r.proposal).toBeUndefined();
  });

  it('record 훅 호출(스코어카드 영속)', async () => {
    let recorded = 0;
    await runLocalBenchMission({
      listModels: async () => fleet,
      benchmark: async () => [sc('gemma', 90)],
      record: (cards) => { recorded = cards.length; },
    });
    expect(recorded).toBe(1);
  });
});
