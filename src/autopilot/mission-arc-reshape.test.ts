// 아크 단위 reshape(split 남발 ② 근본·PLAN-coordinator-arc-reshape) 회귀 가드.
// 보수적 no-reshape 폴백 + concern 단위 판정 + dispatch. self-implement 초안 + 대표 지시 완성.
import { describe, it, expect } from 'bun:test';
import {
  buildArcReshapeInput, decideArcReshape, applyArcReshape,
  type ArcReshapeExecutors, type RawArcReshape, type ArcReshapeInput,
} from './mission-arc-reshape.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arcs: any = [{ arcId: 'a1', name: '구현 아크', intent: '조정자 구현', status: 'building', splitCount: 2, phaseIds: ['p1', 'p2'] }];
const state = { phases: [
  { id: 'p1', title: '기존 심볼 조사', status: 'done', prompt: '조사하라', acceptance: [] },
  { id: 'p2', title: '조정자 구현', status: 'failed', prompt: '구현하라', acceptance: [] },
] };
const mkInput = (): ArcReshapeInput => buildArcReshapeInput('m1', '골 텍스트', arcs, state, 'a1');

describe('buildArcReshapeInput — 전체 아크 문맥 조립(대표: 충분한 문맥)', () => {
  it('done→landedTitles · failed→failurePatterns · concern 계산 · driftedArcId', () => {
    const input = mkInput();
    expect(input.landedTitles).toContain('기존 심볼 조사');
    expect(input.failurePatterns.some((f) => f.includes('조정자 구현'))).toBe(true);
    expect(input.concerns['p2']).toBeDefined(); // gradePhaseGranularity concern 통일
    expect(input.driftedArcId).toBe('a1');
  });
});

describe('decideArcReshape — 보수적 no-reshape 폴백(애매하면 안 건드림)', () => {
  it('무효 action → no-reshape', async () => {
    const d = await decideArcReshape(mkInput(), async () => ({ action: 'garbage' } as RawArcReshape));
    expect(d.action).toBe('no-reshape');
  });
  it('re-decompose targetConcepts<2 → no-reshape(과소분해 차단)', async () => {
    const d = await decideArcReshape(mkInput(), async () => ({ action: 're-decompose-arc', arcId: 'a1', targetConcepts: ['one'] }));
    expect(d.action).toBe('no-reshape');
  });
  it('re-decompose arcId 부재 → no-reshape', async () => {
    const input = buildArcReshapeInput('m1', 'g', arcs, state); // driftedArcId 없음
    const d = await decideArcReshape(input, async () => ({ action: 're-decompose-arc', targetConcepts: ['a', 'b'] }));
    expect(d.action).toBe('no-reshape');
  });
  it('정상 re-decompose(concept 2+) → 채택', async () => {
    const d = await decideArcReshape(mkInput(), async () => ({ action: 're-decompose-arc', arcId: 'a1', targetConcepts: ['조사', '구현'], reason: 'ok' }));
    expect(d.action).toBe('re-decompose-arc');
    expect(d.targetConcepts.length).toBe(2);
  });
  it('resolve throw → no-reshape(fail-soft)', async () => {
    const d = await decideArcReshape(mkInput(), async () => { throw new Error('llm down'); });
    expect(d.action).toBe('no-reshape');
  });
});

describe('applyArcReshape — 액션별 executor dispatch', () => {
  const calls: string[] = [];
  const exec: ArcReshapeExecutors = {
    redecomposeArc: async () => { calls.push('redecompose'); return { ok: true, detail: '3 concern·splitCount reset' }; },
    mergePhases: async () => { calls.push('merge'); return { ok: true }; },
    carveArc: async () => { calls.push('carve'); return { ok: true }; },
    maturitySplit: async () => { calls.push('maturity'); return { ok: true }; },
  };
  it('re-decompose-arc → redecomposeArc', async () => {
    const r = await applyArcReshape('m1', { action: 're-decompose-arc', arcId: 'a1', reason: '', phaseIds: [], targetConcepts: ['a', 'b'] }, exec);
    expect(r.ok).toBe(true); expect(r.action).toBe('re-decompose-arc'); expect(calls).toContain('redecompose');
  });
  it('no-reshape → ok:false(집행 안 함)', async () => {
    const r = await applyArcReshape('m1', { action: 'no-reshape', reason: '', phaseIds: [], targetConcepts: [] }, exec);
    expect(r.ok).toBe(false);
  });
});
