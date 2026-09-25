import { describe, it, expect } from 'bun:test';
import {
  assessPhaseNecessity, trimmablePhases, parseNecessityJson, phaseNecessityPrompt,
  type PhaseForNecessity, type NecessityContext, type RawPhaseVerdict,
} from './mission-phase-necessity.js';

const phases: PhaseForNecessity[] = [
  { id: 'p9', title: 'invalid vault root 계약 테스트를 추가하라', acceptance: 'rejects non-absolute vaultRoot' },
  { id: 'p12', title: 'YouTube URL digest 구현' },
  { id: 'p13', title: 'X/GitHub URL digest 구현' },
];
const ctx: NecessityContext = {
  goal: '어떤 콘텐츠 주소든 소화해 요약+저장',
  landed: ['vault-adapter.test.ts 에 invalid vault root 테스트가 이미 main 에 있음'],
};
const stub = (verdicts: RawPhaseVerdict[]): (() => Promise<RawPhaseVerdict[]>) => () => Promise.resolve(verdicts);

describe('assessPhaseNecessity — 순수 시퀀서(P4a)', () => {
  it('빈 페이즈 → 빈 결과', async () => {
    expect(await assessPhaseNecessity([], ctx, stub([]))).toEqual([]);
  });

  it('랜딩 맥락 없으면 전부 keep(보수적·판정 스킵)', async () => {
    const r = await assessPhaseNecessity(phases, { ...ctx, landed: [] }, stub([{ phaseId: 'p9', verdict: 'trim-satisfied' }]));
    expect(r.every((v) => v.verdict === 'keep')).toBe(true);
  });

  it('이미 랜딩된 페이즈 → trim-satisfied, 나머지 keep', async () => {
    const r = await assessPhaseNecessity(phases, ctx, stub([
      { phaseId: 'p9', verdict: 'trim-satisfied', reason: '이미 main 에 있음' },
      { phaseId: 'p12', verdict: 'keep' },
      { phaseId: 'p13', verdict: 'keep' },
    ]));
    expect(r.find((v) => v.phaseId === 'p9')!.verdict).toBe('trim-satisfied');
    expect(r.find((v) => v.phaseId === 'p12')!.verdict).toBe('keep');
    expect(trimmablePhases(r).map((v) => v.phaseId)).toEqual(['p9']);
  });

  it('판정 누락된 페이즈 → keep 폴백(보수적)', async () => {
    const r = await assessPhaseNecessity(phases, ctx, stub([{ phaseId: 'p9', verdict: 'trim-satisfied' }]));
    expect(r.find((v) => v.phaseId === 'p12')!.verdict).toBe('keep'); // 판정 없음
    expect(r.find((v) => v.phaseId === 'p13')!.verdict).toBe('keep');
  });

  it('유효하지 않은 verdict → keep 폴백', async () => {
    const r = await assessPhaseNecessity(phases, ctx, stub([{ phaseId: 'p9', verdict: 'delete-now' }]));
    expect(r.find((v) => v.phaseId === 'p9')!.verdict).toBe('keep');
  });

  it('merge — 유효한 mergeInto(존재·타자) 만 인정', async () => {
    const r = await assessPhaseNecessity(phases, ctx, stub([{ phaseId: 'p13', verdict: 'merge', mergeInto: 'p12' }]));
    const v = r.find((x) => x.phaseId === 'p13')!;
    expect(v.verdict).toBe('merge');
    expect(v.mergeInto).toBe('p12');
  });

  it('merge — mergeInto 자기참조/부재/미존재 → keep(보수적)', async () => {
    const self = await assessPhaseNecessity(phases, ctx, stub([{ phaseId: 'p13', verdict: 'merge', mergeInto: 'p13' }]));
    expect(self.find((x) => x.phaseId === 'p13')!.verdict).toBe('keep');
    const missing = await assessPhaseNecessity(phases, ctx, stub([{ phaseId: 'p13', verdict: 'merge', mergeInto: 'pX' }]));
    expect(missing.find((x) => x.phaseId === 'p13')!.verdict).toBe('keep');
    const none = await assessPhaseNecessity(phases, ctx, stub([{ phaseId: 'p13', verdict: 'merge' }]));
    expect(none.find((x) => x.phaseId === 'p13')!.verdict).toBe('keep');
  });

  it('LLM 예외 → 전부 keep(fail-soft·보수적)', async () => {
    const throwing = () => Promise.reject(new Error('llm down'));
    const r = await assessPhaseNecessity(phases, ctx, throwing);
    expect(r.every((v) => v.verdict === 'keep')).toBe(true);
    expect(r[0]!.reason).toContain('fail-soft');
  });
});

describe('parseNecessityJson — 순수 파서', () => {
  it('코드펜스+설명 감싼 JSON 배열 추출', () => {
    const out = '설명\n```json\n[{"phaseId":"p9","verdict":"trim-satisfied","reason":"done"}]\n```';
    const r = parseNecessityJson(out);
    expect(r).toEqual([{ phaseId: 'p9', verdict: 'trim-satisfied', reason: 'done' }]);
  });
  it('phaseId 없는 원소 제거', () => {
    expect(parseNecessityJson('[{"verdict":"keep"},{"phaseId":"p1","verdict":"keep"}]')).toEqual([{ phaseId: 'p1', verdict: 'keep' }]);
  });
  it('JSON 아니면 빈 배열', () => {
    expect(parseNecessityJson('no json here')).toEqual([]);
    expect(parseNecessityJson('{"not":"array"}')).toEqual([]);
  });
});

describe('phaseNecessityPrompt — 맥락 주입', () => {
  it('landed 맥락과 페이즈가 프롬프트에 실림 + 보수적 지시', () => {
    const p = phaseNecessityPrompt(phases, ctx);
    expect(p).toContain('invalid vault root 테스트가 이미 main');
    expect(p).toContain('id=p9');
    expect(p).toContain('보수적');
    expect(p).toContain('JSON 배열만');
  });
});
