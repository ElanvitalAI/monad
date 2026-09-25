// ── ShowroomLaneCallable (로컬 LLM) — next-fluent 페르소나 lane (2026-07-15) ──
//
// next-fluent 쇼룸 페르소나(continuator·opportunist·closer)가 도는 lane 콜러블. **옵션**(next-fluent
// 기본은 결정론·laneCallable 미주입). 켜면 이 콜러블이 **로컬 LLM(loopback)**으로 이유를 붙인다(cost 0).
//
// ★ LocalProvider 강제 — resolveDefaultProvider 는 활성 provider(codex 등)를 반환해 로컬 spec 을 외부로
//   보낸다(semantic-supersede 선례). 로컬 전용으로 라우팅해 비용 0·프라이버시 유지.
// ★ fail-soft — 로컬 모델 부재/오류면 빈 텍스트 반환(페르소나 기여 0 → 결정론 후보 rationale 로 degrade).

import type { ShowroomLaneCallable } from './showroom-surface.js';

/** 로컬 LLM 기반 ShowroomLaneCallable. next-fluent 페르소나 opt-in 배선용. */
export function createLocalShowroomLaneCallable(): ShowroomLaneCallable {
  return async (input) => {
    try {
      const { streamLLM, LocalProvider } = await import('../../llm.js');
      const text = await streamLLM(
        [{ role: 'user', content: input.prompt }],
        () => {},
        { model: input.model, provider: LocalProvider, reasoningEffort: 'low', ...(input.signal ? { signal: input.signal } : {}) },
      );
      return { text, modelId: input.model };
    } catch {
      return { text: '', modelId: input.model }; // 로컬 부재/실패 → 결정론 degrade(빈 이유)
    }
  };
}
