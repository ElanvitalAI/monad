// ── 상태줄 비용 — 단가표는 «하나»다 (BACKLOG C9 · 2026-09-25) ──
//
// ⛔ 이 파일은 종전에 «세 번째 단가표»(접두 일치 · 기본가 $0.75/$3 폴백)를 갖고 있었고 정본과 어긋났다
//    (Opus 4.8 $15/$75 ↔ 공식 $5/$25 · 모르는 모델을 기본가로 «아는 척»).
//    ⇒ 이제 정본 `estimateLlmCost`(손 카탈로그 → 정규화 id → config → intelligence-map 정본 → 레지스트리)에 «위임»만 한다.
// ⛔ 모르는 모델은 추측하지 않는다 — `known:false` 로 돌려주고 호출자가 따로 센다(상태줄 `unpricedTurns`).
import { estimateLlmCost } from '../budget/llm-cost.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** 한 턴의 USD. 단가를 모르면 `{ usd: 0, known: false }` — 0 은 «모름»의 자리표일 뿐 합계에 섞지 말라. */
export function costForUsageDetailed(model: string, u: TokenUsage): { usd: number; known: boolean } {
  const r = estimateLlmCost({
    model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    ...(u.cacheReadTokens !== undefined ? { cacheReadInputTokens: u.cacheReadTokens } : {}),
    ...(u.cacheWriteTokens !== undefined ? { cacheCreationInputTokens: u.cacheWriteTokens } : {}),
  });
  return r.kind === 'unknown' ? { usd: 0, known: false } : { usd: r.usd, known: true };
}

/** 하위호환 — 숫자만 필요할 때. ⚠️ 모르는 모델은 0 이다(`costForUsageDetailed` 로 가려라). */
export function costForUsage(model: string, u: TokenUsage): number {
  return costForUsageDetailed(model, u).usd;
}
