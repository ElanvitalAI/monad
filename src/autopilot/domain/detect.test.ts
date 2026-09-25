// detectDomain 단위테스트 — 순수(무네트워크). D1.
import { describe, test, expect } from 'bun:test';
import { detectDomain, classifyDomain } from './detect.js';

describe('detectDomain — 도메인 판정', () => {
  const cases: Array<[string, string]> = [
    ['이 버그 고쳐줘', 'coding'],
    ['mission-engine 리팩토링하고 테스트 추가', 'coding'],
    ['삼성전자 지금 매수 타이밍이야?', 'investment'],
    ['포트폴리오 리밸런싱해줘', 'investment'],
    ['KODEX 레버리지 손절 라인 잡아줘', 'investment'],
    ['반도체 밸류체인 동향 조사해줘', 'business'],
    ['이 주제 딥리서치로 분석해줘', 'business'],
    ['이번 분기 매출 보고서 만들어줘', 'business'],
    ['신제품 마케팅 전략 짜줘', 'business'],
    ['오늘 날씨 알려줘', 'general'],
  ];
  for (const [goal, expected] of cases) {
    test(`"${goal}" → ${expected}`, () => {
      expect(detectDomain(goal)).toBe(expected as any);
    });
  }

  test('coding 동사가 투자 명사와 동점이면 coding 우선(매매 로직 구현)', () => {
    // "매매"(investment) + "구현"(coding) 동점 → 우선순위 coding.
    expect(detectDomain('매매 로직 구현해줘')).toBe('coding');
  });

  test('coding 앵커(구현)는 business 조사키워드 다수와 섞여도 coding 확정(대표 2026-07-12)', () => {
    // "구현"(coding 강앵커) + "조사·분석·정리·수집"(business 다수) → 이전엔 동점 low→맥락 business 로
    //   뒤집혔으나, coding 앵커 있으면 coding high 확정.
    const c = classifyDomain('기억 생애주기 시스템을 설계하고 구현해줘. 조사·분석·정리·수집 포함');
    expect(c.domain).toBe('coding');
    expect(c.confidence).toBe('high');
  });

  test('투자 미션이 리서치를 품으면 investment(리서치 후 매매)', () => {
    // "리서치"(business) + "매매"(investment) → 우선순위 investment > business.
    expect(detectDomain('삼성 리서치 후 매매 판단해줘')).toBe('investment');
  });

  test('research 는 횡단 능력 — 도메인 앵커가 있으면 그리로(약신호)', () => {
    // research-in-coding → coding(구현 앵커).
    expect(detectDomain('이 라이브러리 리서치해서 구현해줘')).toBe('coding');
    // research-in-investment → investment(매매 앵커).
    expect(detectDomain('삼성전자 시장 조사 후 매매 판단')).toBe('investment');
    // 순수 조사(앵커 없음) → business 지식업무.
    expect(detectDomain('반도체 산업 동향 조사해줘')).toBe('business');
  });

  test('무히트 → general', () => {
    expect(detectDomain('음 그냥 얘기 좀')).toBe('general');
  });
});
