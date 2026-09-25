// ── Domain 판정 (WHAT 축) — D1 · 2026-07-11 ────────────────────────────────
//
// 골 → 도메인(coding/investment/research/general) 결정론 휴리스틱. triage.ts 의
// detectSignals(HOW 축)와 직교. 키워드 스코어링 + 우선순위 tie-break(순수·무IO).
//
// 우선순위: coding > investment > business > general.
//   - 명시적 코딩 동사(구현/리팩토링/버그)는 강신호 → 다른 도메인 명사와 동점이면 coding.
//     (예: "매매 로직 구현" = monad 코드베이스 작업 → coding executor).
//   - 투자 액션(매수/매도/종목/포트폴리오)은 investment(집행 executor=trade-cycle).
//   - business = 지식노동 substrate(보고서/전략/마케팅/회계 …) — 가장 넓은 catch-all·최하위.
//
// ★ research(조사/리서치/분석)는 도메인이 아니라 **횡단 능력**(모든 도메인이 씀) — business
//   키워드에 있지만 **약신호(fallback)**다. 실제 도메인 앵커(구현·매매)가 있으면 우선순위가
//   그리로 라우팅한다: "라이브러리 리서치해서 구현"→coding, "삼성 조사 후 매매"→investment.
//   앵커 없는 순수 조사만 business(지식업무 결과물). PLAN §3.5.
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §3.3·§3.5.

import type { Domain } from './types.js';

const KEYWORDS: Record<Exclude<Domain, 'general'>, string[]> = {
  coding: [
    '구현', '리팩토링', '리팩터', '버그', '고쳐', '고침', '코드', '파일', '함수', '모듈',
    '배선', '리팩', '테스트', '빌드', '커밋', '병합', 'pr ', ' pr', '스키마', '엔드포인트',
    'implement', 'refactor', 'bug', 'fix', 'function', 'module', 'commit', 'endpoint',
  ],
  investment: [
    '매매', '매수', '매도', '종목', '포트폴리오', '리밸런', '주식', '코스피', 'kospi',
    '나스닥', '삼성전자', 'sk하이닉스', '시세', '수급', '선물', '옵션', '레버리지', '투자',
    'etf', '배당', '손절', '익절', '체결', '트레이', 'trade', 'buy', 'sell', 'portfolio',
    'position', 'ticker', 'stock', 'dividend',
  ],
  // business(업무 자동화) — 지식노동 실행 substrate. 전략/마케팅/회계/연구/조사 등 여러
  // discipline 을 담는다(discipline 은 이 도메인 안의 expertise 렌즈로 분화·PLAN §3.7).
  business: [
    '업무', '자동화', '보고서', '리포트', '브리핑', '다이제스트', '이메일', '일정', '문서',
    '정리', '조사', '리서치', '분석', '요약', '수집', '모니터링', '워크플로우',
    '전략', '마케팅', '회계', '영업', '기획', '경쟁분석', '동향', '비교', '트렌드',
    'report', 'briefing', 'digest', 'automate', 'workflow', 'document', 'email',
    'schedule', 'research', 'analyze', 'analyse', 'summarize', 'summarise', 'monitor',
    'strategy', 'marketing', 'accounting',
  ],
};

/** 우선순위(동점 시) — 앞쪽이 우선. business = 가장 넓은 catch-all → 최하위. */
const PRIORITY: Array<Exclude<Domain, 'general'>> = ['coding', 'investment', 'business'];

function matchedKeywords(goal: string, kws: string[]): string[] {
  const g = goal.toLowerCase();
  return kws.filter((w) => g.includes(w));
}

// research 약신호(횡단 능력·§3.5) — business 가 이것만으로 이겼으면 모호(어느 도메인의
// 선행 조사일 수 있음) → confidence low 로 맥락 resolver 가 풀게 한다.
const RESEARCH_VERBS = new Set([
  '조사', '리서치', '분석', '요약', '수집', '모니터링', '동향', '비교', '트렌드',
  'research', 'analyze', 'analyse', 'summarize', 'summarise', 'monitor',
]);

// coding 강앵커(명시적 코드 작업 동사) — 동점이어도 coding 확정(상단 §3.5·주석 의도·대표 2026-07-12).
// "설계하고 구현" 이 business 조사키워드에 밀려 low→맥락편향 business 로 뒤집히던 갭 정정.
const CODING_ANCHORS = new Set(['구현', '리팩토링', '리팩터', '버그', '고쳐', '고침', 'implement', 'refactor']);

export interface DomainClassification {
  domain: Domain;
  /** 키워드 확신도 — high(명확 앵커)·medium(약)·low(동점/무히트/business-research-verb 모호). */
  confidence: 'high' | 'medium' | 'low';
  /** 동점 후보(모호성). 단일이면 [domain]. */
  candidates: Domain[];
}

/** 도메인 분류 — confidence·candidates 포함(§3.8 ambiguity 1급화). 순수함수. */
export function classifyDomain(goal: string): DomainClassification {
  const scored = PRIORITY.map((d) => {
    const hits = matchedKeywords(goal, KEYWORDS[d]);
    return { domain: d, score: hits.length, hits };
  });
  const max = Math.max(...scored.map((s) => s.score));
  if (max === 0) return { domain: 'general', confidence: 'low', candidates: [] };
  const top = scored.filter((s) => s.score === max).map((s) => s.domain);
  const domain = PRIORITY.find((d) => top.includes(d))!;
  const sortedScores = scored.map((s) => s.score).sort((a, b) => b - a);
  const margin = sortedScores[0]! - (sortedScores[1] ?? 0);
  // business 가 research-verb 로만 이겼나(모호).
  const bizHits = scored.find((s) => s.domain === 'business')!.hits;
  const businessOnlyResearchVerb = domain === 'business' && bizHits.length > 0
    && bizHits.every((h) => RESEARCH_VERBS.has(h));
  // ★ coding 강앵커(구현/리팩토링/버그…)가 있으면 business 조사키워드가 아무리 많아도 coding 확정
  //   — "명시적 코딩 동사는 강신호"(상단 §3.5 주석 의도). "설계하고 구현"이 조사키워드에 밀려
  //   low→맥락편향 business 로 뒤집히던 갭 정정(대표 2026-07-12). 단 investment 앵커(매매)가 함께
  //   있으면 우선순위상 위에서 이미 top 처리 — 여기선 coding 앵커만 있는 경우를 구제.
  const codingHits = scored.find((s) => s.domain === 'coding')!.hits;
  if (codingHits.some((h) => CODING_ANCHORS.has(h))) {
    return { domain: 'coding', confidence: 'high', candidates: ['coding'] };
  }
  let confidence: DomainClassification['confidence'];
  if (top.length > 1 || businessOnlyResearchVerb) confidence = 'low';
  else if (margin >= 2) confidence = 'high';
  else confidence = 'medium';
  return { domain, confidence, candidates: top.length > 1 ? top : [domain] };
}

/** 골의 도메인 판정(단일·back-compat). 맥락 해소는 resolveDomain(§3.8·D5). 순수함수. */
export function detectDomain(goal: string): Domain {
  return classifyDomain(goal).domain;
}
