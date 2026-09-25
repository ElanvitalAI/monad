/**
 * S4 P2b **1층 호출 억제 게이트** — LLM 판단은 *의미 있는 관측 순간*에만 허용한다.
 *
 * ⚠️ **엣지 트리거만 쓴다**(2026-07-26 리뷰 must-fix · 직접 개입 수리):
 * 초안은 `transition || stall || state === 'blocked'` 였는데 `blocked` 는 **상태(레벨)** 이지
 * **사건(엣지)** 이 아니다. 자식이 승인 프롬프트에 멈춰 있으면 그 상태가 유지되는 **매 폴 tick(~1s)**
 * 마다 brain 을 불러 — 10분 정지 = LLM 수백 회 = 비용 폭발 + 폴 루프 지연. 그건 이 게이트의 존재
 * 이유(호출 억제)를 정면으로 부순다.
 *
 * ⭐ 그리고 `blocked` 조건은 **불필요**하다:
 *   · **진입 순간**(→blocked)은 이미 `transition` 이 잡는다(`observeFrame` 이 전이를 1회 낸다).
 *   · **지속**은 `stall` 사다리(15s·60s·5min)가 문턱당 1회로 잡는다 — 정확히 엣지 트리거다.
 * ⇒ 두 신호로 진입·지속이 모두 덮이므로 `blocked` 를 빼면 **커버리지 손실 없이** 폭주만 사라진다.
 *
 * ⚠️ 이 결함의 출처는 골 스펙이었다(설계 §5b) — 설계 문서도 함께 정정했다.
 */
export interface BrainEdge {
  /** 화면-상태 전이가 발생했나(`observeFrame` transition) — 엣지. `→blocked` 진입도 여기 포함된다. */
  readonly transition: boolean;
  /** stall 사다리 문턱을 통과했나(`observeFrame` stall) — 엣지. 정지 *지속*을 문턱당 1회로 잡는다. */
  readonly stall: boolean;
}

/**
 * ⭐ **게이트 단일 소스**(리뷰 should-fix) — 트리거 라벨을 반환하고, `undefined` 가 곧 "상담하지 않음"이다.
 * 종전엔 `shouldConsultBrain`(boolean)과 `brainTrigger`(라벨)가 **같은 게이트를 두 번 인코딩**해
 * 한쪽만 고치면 조용히 갈라졌다. 하나로 합쳐 구조적으로 불가능하게 만든다.
 */
export function brainTrigger(edge: BrainEdge): 'transition' | 'stall' | undefined {
  return edge.transition ? 'transition' : edge.stall ? 'stall' : undefined;
}

/** 이 tick 에 brain 을 부를까 — `brainTrigger` 의 얇은 술어(중복 인코딩 아님·라벨 유무가 곧 판정). */
export function shouldConsultBrain(edge: BrainEdge): boolean {
  return brainTrigger(edge) !== undefined;
}
