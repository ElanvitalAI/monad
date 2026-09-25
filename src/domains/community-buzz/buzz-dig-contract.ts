// ── BuzzDigContract — Tier2 디깅 에이전트 계약(읽기전용) · 버즈 P3c · 2026-07-09 ─
//
// PLAN §3b Tier2 · 레버리지 runTurn+Contract 계승([[DESIGN-leverage-decision-agent]]).
// 커뮤니티에서 급부상한 종목/이슈를 순간 디깅 — 파생·수급·뉴스·lead/lag 교차확인 → verdict.
// 현 dig-runner(규칙+단발 LLM)보다 깊은 agentic 다도구 추론. 매매 격리(READ-ONLY).
//
// 도구셋 = 화이트리스트만. submit_trade_decision·place_order 등 매매도구 없음.

export interface BuzzDigContract {
  /** 도구 화이트리스트(읽기전용 분석 도구만). */
  tools: string[];
}

export function buildBuzzDigContract(): BuzzDigContract {
  return { tools: ['finance_kr_flow', 'finance_quote', 'fact_check', 'memory_recall', 'OmniSearch'] };
}

/** 시스템 프롬프트(순수·ASCII+한글). 레버리지 통찰(파생>현물 외인) 계승·매매 격리. */
export function buildBuzzDigPrompt(): string {
  return [
    '너는 한국 주식 커뮤니티(에펨코리아)에서 급부상한 종목/이슈를 순간 디깅하는 투자 분석가다.',
    '',
    '규율:',
    '- 커뮤니티 반응은 신호의 시작일 뿐이다. 반드시 파생(선물 미결제·풋콜)·현물 수급·뉴스로 교차 검증한다.',
    '- 현물 외국인 수급만 믿지 마라. 급락이 선물발 프로그램 매도일 수 있다(finance_kr_flow 로 파생을 봐라).',
    '- lead vs lag: fact_check 로 이미 뉴스에 있나(lagging) 아니면 SNS 선행(leading)인가 판정한다.',
    '- 과거 이 종목/이슈에 대해 monad 가 무엇을 알렸나 memory_recall 로 회상한다.',
    '- 반드시 도구를 실제로 호출해 데이터를 당긴 뒤 판단한다. 지식으로 단정하지 마라.',
    '- READ-ONLY. 매매 지시·주문·집행 금지. 분석과 verdict 만 낸다.',
    '',
    '산출(마지막에 한글로):',
    'VERDICT: bullish|bearish|neutral',
    'CONFIDENCE: low|med|high',
    'WHY: 근거 2-3줄(파생/수급/뉴스 교차 결과·divergence 여부)',
    'WATCH: 주의점 1줄',
  ].join('\n');
}

/** 디깅 대상 태스크(순수). ticker + 예시 제목(커뮤니티 맥락). */
export function buildBuzzDigTask(ticker: string, examples: string[], meta?: { ratio?: number; leadLag?: string | null }): string {
  const ex = examples.slice(0, 3).map(t => `- ${t}`).join('\n');
  const m = meta?.ratio ? ` (급부상 x${meta.ratio}${meta.leadLag ? `·${meta.leadLag}` : ''})` : '';
  return [
    `지금 커뮤니티에서 급부상한 종목/이슈: ${ticker}${m}`,
    '커뮤니티 글 예시:',
    ex,
    '',
    '이 급부상을 디깅하라: 파생(선물/풋콜)·현물 수급·뉴스·lead/lag 를 도구로 교차 확인하고,',
    '현물↔파생 divergence 가 있는지 보고, VERDICT/CONFIDENCE/WHY/WATCH 를 내라.',
  ].join('\n');
}
