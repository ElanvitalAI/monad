// 도메인 맥락 resolver 단위테스트 — 순수(무네트워크). D5.
import { describe, test, expect } from 'bun:test';
import { classifyDomain } from './detect.js';
import { resolveDomain, dominantRecentDomain, parseDomainResponse } from './resolve.js';

describe('classifyDomain — confidence/candidates(§3.8)', () => {
  test('명확 앵커(구현+리팩토링) → high', () => {
    const c = classifyDomain('이 모듈 리팩토링하고 버그 고쳐줘');
    expect(c.domain).toBe('coding');
    expect(c.confidence).toBe('high');
  });
  test('약신호 단일(매수 하나) → medium', () => {
    const c = classifyDomain('삼성 매수');
    expect(c.domain).toBe('investment');
    expect(c.confidence).toBe('medium');
  });
  test('business 가 research-verb 로만 이기면 모호 → low', () => {
    // "반도체 동향 조사" — business 가 조사/동향(research-verb)로만 이김.
    const c = classifyDomain('반도체 산업 동향 조사해줘');
    expect(c.domain).toBe('business');
    expect(c.confidence).toBe('low');
  });
  test('무히트 → general/low', () => {
    const c = classifyDomain('그냥 얘기하자');
    expect(c.domain).toBe('general');
    expect(c.confidence).toBe('low');
  });
});

describe('dominantRecentDomain — 최근 가중', () => {
  test('최근일수록 가중(recent[0] 우세)', () => {
    expect(dominantRecentDomain(['investment', 'coding', 'coding'])).toBe('investment');
  });
  test('general 제외', () => {
    expect(dominantRecentDomain(['general', 'general', 'coding'])).toBe('coding');
  });
  test('빈 → null', () => {
    expect(dominantRecentDomain([])).toBeNull();
  });
});

describe('resolveDomain — 맥락 사다리(§3.8)', () => {
  test('high 는 맥락 무시(키워드 확정)', async () => {
    const r = await resolveDomain('이 버그 고치고 리팩토링', { recentDomains: ['investment', 'investment'] });
    expect(r.domain).toBe('coding');
    expect(r.via).toBe('keyword');
  });

  test('★ 모호(low)한 "반도체 조사" → 최근 투자활동이면 investment(맥락 편향)', async () => {
    const r = await resolveDomain('반도체 산업 동향 조사해줘', { recentDomains: ['investment', 'investment', 'coding'] });
    expect(r.domain).toBe('investment');
    expect(r.via).toBe('context');
  });

  test('모호(low)인데 최근이력 없으면 키워드 유지(business)', async () => {
    const r = await resolveDomain('반도체 산업 동향 조사해줘', { recentDomains: [] });
    expect(r.domain).toBe('business');
    expect(r.via).toBe('keyword');
  });

  test('LLM seam — 최근이력 없고 classify 주입 시 그 판정', async () => {
    const r = await resolveDomain('반도체 산업 동향 조사해줘', { classify: async () => 'investment' });
    expect(r.domain).toBe('investment');
    expect(r.via).toBe('llm');
  });

  test('medium 은 최근 도메인이 후보에 있을 때만 편향(아니면 키워드)', async () => {
    // "삼성 매수"=investment medium. 최근 coding → 후보(investment) 밖 → 키워드 유지.
    const r = await resolveDomain('삼성 매수', { recentDomains: ['coding', 'coding'] });
    expect(r.domain).toBe('investment');
    expect(r.via).toBe('keyword');
  });
});

describe('resolveDomain — luna 도메인 승격(2026-07-20)', () => {
  test('★ business-high(주제어 위양성)도 classify 주입 시 luna 재정 — "요약 기능 구현" → coding', async () => {
    // "유튜브 요약 정리 기능을 텔레그램에 만들어줘": 주제어(요약·정리)로 business high 확정되지만
    //   실제로는 구현 미션. luna 가 coding 으로 재정. keywordDomain 은 baseline(business) 보존.
    const goal = '유튜브 요약 정리 기능을 텔레그램에 만들어줘';
    expect(classifyDomain(goal).domain).toBe('business');
    const r = await resolveDomain(goal, { classify: async () => 'coding' });
    expect(r.domain).toBe('coding');
    expect(r.via).toBe('llm');
    expect(r.keywordDomain).toBe('business');
  });

  test('강앵커 high(구현/버그)는 classify 미호출 — 키워드 신뢰(비용·무회귀)', async () => {
    let called = false;
    const r = await resolveDomain('이 버그 고쳐줘', {
      classify: async () => { called = true; return 'business'; },
    });
    expect(r.domain).toBe('coding');
    expect(r.via).toBe('keyword');
    expect(called).toBe(false);   // 강앵커 high 는 luna 우회
  });

  test('luna 미결(null)이면 키워드 baseline 유지(business) — fail-soft', async () => {
    const goal = '유튜브 요약 정리 기능을 텔레그램에 만들어줘';
    const r = await resolveDomain(goal, { classify: async () => null });
    expect(r.domain).toBe('business');
    expect(r.via).toBe('keyword');
  });
});

describe('parseDomainResponse — luna 응답 파싱', () => {
  test('유효 JSON → 도메인', () => {
    expect(parseDomainResponse('{"domain":"coding","rationale":"build a feature"}')).toBe('coding');
  });
  test('앞뒤 잡텍스트 있어도 추출', () => {
    expect(parseDomainResponse('음... {"domain":"investment"} 입니다')).toBe('investment');
  });
  test('무효 도메인 → null', () => {
    expect(parseDomainResponse('{"domain":"nonsense"}')).toBeNull();
  });
  test('JSON 아님 → null', () => {
    expect(parseDomainResponse('coding 입니다')).toBeNull();
  });
});
