// 분해 게이팅 비평 에이전트 코어 단위테스트 — 파서·프롬프트·verdict·fail-soft (judge 주입 seam).
import { describe, it, expect } from 'bun:test';
import {
  buildGatePrompt,
  parseGateResult,
  buildGateReviseComment,
  gateDecomposition,
  type DecompGateContext,
} from '../src/autopilot/mission-decomp-gate.js';
import type { DecompCritiquePhase } from '../src/autopilot/mission-decomp-critique.js';

const phase = (id: string, title: string): DecompCritiquePhase => ({ id, title, prompt: `do ${title}`, acceptance: ['빌드 통과'] });
const PHASES = [phase('p0', '아크1 감사'), phase('p1', '아크2 작성')];
const CTX: DecompGateContext = { goal: '범용 콘텐츠 다이제스트', arcs: ['아크1', '아크2'], groundingFiles: ['yt-vault.ts'] };

describe('buildGatePrompt — 정황 주입', () => {
  it('골·아크·grounding·페이즈를 프롬프트에 포함', () => {
    const p = buildGatePrompt(PHASES, { ...CTX, confirmedDesign: '아크 2개', research: '조사 요지' });
    expect(p).toContain('범용 콘텐츠 다이제스트');
    expect(p).toContain('Arcs (2)');
    expect(p).toContain('yt-vault.ts');
    expect(p).toContain('아크1 감사');
    expect(p).toContain('Confirmed design');
    expect(p).toContain('Research notes');
    expect(p).toContain('"verdict":"pass|revise|reject"');
  });
  it('MULTI-ARC 는 정상(breadth 만으로 reject 금지) 지시 포함', () => {
    expect(buildGatePrompt(PHASES, CTX)).toContain('MULTIPLE ARCS in one');
  });
});

describe('parseGateResult — 관대 파싱·fail-soft', () => {
  it('pass 판정', () => {
    const r = parseGateResult('{"verdict":"pass","reason":"coherent","perPhase":[],"reviseHints":[]}', 2);
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('coherent');
  });
  it('revise 판정 + perPhase + reviseHints', () => {
    const raw = '{"verdict":"revise","reason":"over-scope","perPhase":[{"index":0,"ok":false,"issue":"과대","hint":"분리"}],"reviseHints":["아크1을 2개로"]}';
    const r = parseGateResult(raw, 2);
    expect(r.verdict).toBe('revise');
    expect(r.perPhase[0]).toEqual({ index: 0, ok: false, issue: '과대', hint: '분리' });
    expect(r.reviseHints).toEqual(['아크1을 2개로']);
  });
  it('reject 판정', () => {
    expect(parseGateResult('{"verdict":"reject","reason":"mirage"}', 2).verdict).toBe('reject');
  });
  it('범위 밖 index perPhase 는 무시(방어)', () => {
    const r = parseGateResult('{"verdict":"revise","perPhase":[{"index":9,"ok":false}]}', 2);
    expect(r.perPhase).toHaveLength(0);
  });
  it('알 수 없는 verdict → pass(보수)', () => {
    expect(parseGateResult('{"verdict":"maybe"}', 2).verdict).toBe('pass');
  });
  it('JSON 아님 → pass 폴백(fail-soft)', () => {
    const r = parseGateResult('그냥 텍스트', 2);
    expect(r.verdict).toBe('pass');
    expect(r.reason).toContain('파싱 실패');
  });
  it('fence 감싼 JSON 도 추출', () => {
    expect(parseGateResult('```json\n{"verdict":"reject"}\n```', 2).verdict).toBe('reject');
  });
});

describe('buildGateReviseComment — reviseContext 조립', () => {
  it('힌트·페이즈 지적 포함', () => {
    const c = buildGateReviseComment({
      verdict: 'revise', reason: 'x',
      perPhase: [{ index: 0, ok: false, issue: '과대', hint: '2개로 분리' }, { index: 1, ok: true }],
      reviseHints: ['조사 근거 강화'],
    });
    expect(c).toContain('게이팅(terra) 정련');
    expect(c).toContain('조사 근거 강화');
    expect(c).toContain('페이즈[0] 과대 → 2개로 분리');
    expect(c).not.toContain('페이즈[1]'); // ok=true 는 제외
    expect(c).toContain('단일책임');
  });
});

describe('gateDecomposition — judge 주입·fail-soft', () => {
  it('judge 주입으로 verdict 반환', async () => {
    const r = await gateDecomposition(PHASES, CTX, { judge: async () => '{"verdict":"revise","reason":"fix","reviseHints":["h"]}' });
    expect(r.verdict).toBe('revise');
    expect(r.reviseHints).toEqual(['h']);
  });
  it('judge throw → pass 폴백(비파괴)', async () => {
    const r = await gateDecomposition(PHASES, CTX, { judge: async () => { throw new Error('terra down'); } });
    expect(r.verdict).toBe('pass');
    expect(r.reason).toContain('실패');
  });
  it('페이즈 0개 → 게이팅 skip(pass)', async () => {
    const r = await gateDecomposition([], CTX, { judge: async () => { throw new Error('should not call'); } });
    expect(r.verdict).toBe('pass');
    expect(r.reason).toContain('skip');
  });
});
