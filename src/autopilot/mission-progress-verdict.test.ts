import { describe, it, expect } from 'bun:test';
import {
  assessEvidenceSufficiency, decideProgressVerdict, parseJsonObject, sufficiencyPrompt, verdictPrompt,
  runSituationAssessment,
  type StuckEvidence, type RawSufficiency, type RawVerdict,
} from './mission-progress-verdict.js';

const ev: StuckEvidence = {
  goal: '어떤 콘텐츠 주소든 소화',
  phaseTitle: '기존 digest 계약과 재사용 primitive를 확정하라',
  failClass: 'budget-exhausted', recurrence: 3, attemptTrail: 'terra→opus 소진',
  groundingFacts: ['src/content-absorb/vault-adapter.ts 존재', 'omni-digest 스킬 존재'],
  researchFindings: [],
  doneContext: ['vault-adapter 구현·테스트 랜딩'],
};
const sStub = (r: RawSufficiency): (() => Promise<RawSufficiency>) => () => Promise.resolve(r);
const vStub = (r: RawVerdict): (() => Promise<RawVerdict>) => () => Promise.resolve(r);

describe('assessEvidenceSufficiency — 증거 충분성(P6)', () => {
  it('sufficient=false + gaps → 부족(추가 조사)', async () => {
    const r = await assessEvidenceSufficiency(ev, sStub({ sufficient: false, gaps: ['기존 digest 코드 grounding', '외부 X API 계약'], reason: '핵심 계약 미확인' }));
    expect(r.sufficient).toBe(false);
    expect(r.gaps.length).toBe(2);
  });
  it('sufficient=true → 충분(gap 무시)', async () => {
    const r = await assessEvidenceSufficiency(ev, sStub({ sufficient: true, gaps: ['x'] }));
    expect(r.sufficient).toBe(true);
    expect(r.gaps).toEqual([]);
  });
  it('sufficient=false 인데 gap 없음 → 충분(무한조사 방지)', async () => {
    const r = await assessEvidenceSufficiency(ev, sStub({ sufficient: false, gaps: [] }));
    expect(r.sufficient).toBe(true);
  });
  it('LLM 실패 → 충분(보수적·무한조사 방지)', async () => {
    const r = await assessEvidenceSufficiency(ev, () => Promise.reject(new Error('down')));
    expect(r.sufficient).toBe(true);
    expect(r.reason).toContain('무한조사 방지');
  });
});

describe('decideProgressVerdict — 진행 판단(P6)', () => {
  it('continue', async () => expect((await decideProgressVerdict(ev, vStub({ action: 'continue', reason: '예산만' }))).action).toBe('continue'));
  it('arc-adjust', async () => expect((await decideProgressVerdict(ev, vStub({ action: 'arc-adjust' }))).action).toBe('arc-adjust'));
  it('replan', async () => expect((await decideProgressVerdict(ev, vStub({ action: 'replan', reason: '접근 재설계' }))).action).toBe('replan'));
  it('partial-stop', async () => expect((await decideProgressVerdict(ev, vStub({ action: 'partial-stop' }))).action).toBe('partial-stop'));
  it('유효하지 않은 action → continue(보수적)', async () => {
    expect((await decideProgressVerdict(ev, vStub({ action: 'nuke' }))).action).toBe('continue');
  });
  it('LLM 실패 → continue(fail-soft)', async () => {
    const r = await decideProgressVerdict(ev, () => Promise.reject(new Error('down')));
    expect(r.action).toBe('continue');
    expect(r.reason).toContain('fail-soft');
  });
});

describe('runSituationAssessment — 상황점검 오케스트레이터(P6)', () => {
  it('증거 부족 + verdict continue → replan 승격(추가 조사 우선)', async () => {
    const r = await runSituationAssessment(ev,
      sStub({ sufficient: false, gaps: ['기존 digest 코드'] }),
      vStub({ action: 'continue' }));
    expect(r.verdict.action).toBe('replan'); // 부족한데 continue 면 재수집 우선
    expect(r.sufficiency.sufficient).toBe(false);
  });
  it('증거 부족 + verdict partial-stop → replan 승격(프리매처 종결 방지)', async () => {
    const r = await runSituationAssessment(ev, sStub({ sufficient: false, gaps: ['x'] }), vStub({ action: 'partial-stop' }));
    expect(r.verdict.action).toBe('replan');
  });
  it('증거 충분 → verdict 그대로(partial-stop 유지)', async () => {
    const r = await runSituationAssessment(ev, sStub({ sufficient: true }), vStub({ action: 'partial-stop', reason: '근본 난제' }));
    expect(r.verdict.action).toBe('partial-stop');
  });
  it('증거 부족이어도 verdict arc-adjust/replan 은 유지(승격 대상 아님)', async () => {
    const r = await runSituationAssessment(ev, sStub({ sufficient: false, gaps: ['x'] }), vStub({ action: 'arc-adjust' }));
    expect(r.verdict.action).toBe('arc-adjust');
  });
});

describe('parseJsonObject · 프롬프트', () => {
  it('코드펜스 JSON 파싱', () => expect(parseJsonObject('```json\n{"action":"replan"}\n```')).toEqual({ action: 'replan' }));
  it('JSON 아니면 {}', () => expect(parseJsonObject('nope')).toEqual({}));
  it('sufficiencyPrompt — 증거+gap 지시', () => {
    const p = sufficiencyPrompt(ev);
    expect(p).toContain('vault-adapter.ts 존재');
    expect(p).toContain('무한 조사 금지');
    expect(p).toContain('sufficient');
  });
  it('verdictPrompt — 4판정+증거 기반', () => {
    const p = verdictPrompt(ev);
    expect(p).toContain('partial-stop');
    expect(p).toContain('replan');
    expect(p).toContain('증거 기반');
  });
});
