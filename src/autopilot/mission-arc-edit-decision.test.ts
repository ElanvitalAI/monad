import { describe, it, expect } from 'bun:test';
import {
  decideArcEdit, arcEditPrompt, parseArcEditJson, applyArcEdit,
  type StuckPhaseInfo, type ArcEditContext, type RawArcEdit, type ArcEditExecutors, type ArcEditDecision,
} from './mission-arc-edit-decision.js';

const phase: StuckPhaseInfo = { phaseId: 'p12', title: '기존 digest 계약과 재사용 primitive를 확정하라', arcId: 'arc-2', failClass: 'budget-exhausted', attempts: 3, summary: 'terra→opus 소진' };
const ctx: ArcEditContext = { goal: '어떤 콘텐츠 주소든 소화', landed: ['vault-adapter 구현·테스트 main 랜딩'], arcSummary: 'arc-1(vault) done · arc-2(digest) 진행' };
const stub = (r: RawArcEdit): (() => Promise<RawArcEdit>) => () => Promise.resolve(r);

describe('decideArcEdit — 순수 브레인(P5b)', () => {
  it('already-satisfied → delete-phase(결정론 지름길·LLM 무관)', async () => {
    const r = await decideArcEdit({ ...phase, failClass: 'already-satisfied' }, ctx, stub({ action: 'no-edit' }));
    expect(r.action).toBe('delete-phase'); // LLM 이 no-edit 라 해도 지름길 우선
  });

  it('LLM split-phase → split-phase', async () => {
    expect((await decideArcEdit(phase, ctx, stub({ action: 'split-phase', reason: '과대' }))).action).toBe('split-phase');
  });

  it('LLM delete-phase → delete-phase', async () => {
    expect((await decideArcEdit(phase, ctx, stub({ action: 'delete-phase', reason: 'obsolete' }))).action).toBe('delete-phase');
  });

  it('set-arc-done — arcId 있으면 인정(phase.arcId 폴백)', async () => {
    const r = await decideArcEdit(phase, ctx, stub({ action: 'set-arc-done', reason: '통합 충족' }));
    expect(r.action).toBe('set-arc-done');
    expect(r.arcId).toBe('arc-2'); // phase.arcId 폴백
  });

  it('set-arc-done — arcId 부재(phase.arcId 도 없음) → no-edit(보수적)', async () => {
    const r = await decideArcEdit({ ...phase, arcId: undefined }, ctx, stub({ action: 'set-arc-done' }));
    expect(r.action).toBe('no-edit');
  });

  it('유효하지 않은 action → no-edit(보수적)', async () => {
    expect((await decideArcEdit(phase, ctx, stub({ action: 'nuke-everything' }))).action).toBe('no-edit');
  });

  it('LLM 예외 → no-edit(fail-soft·보수적)', async () => {
    const r = await decideArcEdit(phase, ctx, () => Promise.reject(new Error('down')));
    expect(r.action).toBe('no-edit');
    expect(r.reason).toContain('fail-soft');
  });

  it('no-edit 명시 → no-edit', async () => {
    expect((await decideArcEdit(phase, ctx, stub({ action: 'no-edit', reason: '정상 재시도로 풀림' }))).action).toBe('no-edit');
  });
});

describe('applyArcEdit — dispatch(P5c·executors 주입)', () => {
  const calls: string[] = [];
  const exec: ArcEditExecutors = {
    splitPhase: async (_m, p) => { calls.push(`split:${p}`); return { ok: true, subPhaseCount: 3 }; },
    deletePhase: async (_m, p) => { calls.push(`delete:${p}`); return { ok: true }; },
    setArcDone: async (_m, a) => { calls.push(`arcdone:${a}`); return { ok: true }; },
  };
  const dec = (over: Partial<ArcEditDecision>): ArcEditDecision => ({ action: 'no-edit', phaseId: 'p12', reason: 'r', ...over });

  it('no-edit → 무집행', async () => {
    calls.length = 0;
    const r = await applyArcEdit('m1', dec({ action: 'no-edit' }), exec);
    expect(r.ok).toBe(true); expect(calls).toEqual([]);
  });
  it('split-phase → splitPhase 호출 + subPhase detail', async () => {
    calls.length = 0;
    const r = await applyArcEdit('m1', dec({ action: 'split-phase' }), exec);
    expect(r.ok).toBe(true); expect(r.detail).toContain('3'); expect(calls).toEqual(['split:p12']);
  });
  it('delete-phase → deletePhase 호출', async () => {
    calls.length = 0;
    await applyArcEdit('m1', dec({ action: 'delete-phase' }), exec);
    expect(calls).toEqual(['delete:p12']);
  });
  it('set-arc-done(arcId) → setArcDone 호출', async () => {
    calls.length = 0;
    await applyArcEdit('m1', dec({ action: 'set-arc-done', arcId: 'arc-2' }), exec);
    expect(calls).toEqual(['arcdone:arc-2']);
  });
  it('set-arc-done arcId 부재 → 무집행·에러', async () => {
    calls.length = 0;
    const r = await applyArcEdit('m1', dec({ action: 'set-arc-done' }), exec);
    expect(r.ok).toBe(false); expect(calls).toEqual([]);
  });
});

describe('parseArcEditJson — 순수 파서', () => {
  it('코드펜스 감싼 JSON 객체 추출', () => {
    expect(parseArcEditJson('```json\n{"action":"split-phase","reason":"big"}\n```')).toEqual({ action: 'split-phase', reason: 'big' });
  });
  it('JSON 아니면 빈 객체(→no-edit)', () => {
    expect(parseArcEditJson('no json')).toEqual({});
  });
});

describe('arcEditPrompt — 맥락 주입', () => {
  it('막힌 페이즈·landed·아크 구조·보수적 지시 실림', () => {
    const p = arcEditPrompt(phase, ctx);
    expect(p).toContain('id=p12');
    expect(p).toContain('vault-adapter 구현');
    expect(p).toContain('보수적');
    expect(p).toContain('JSON');
  });
});
