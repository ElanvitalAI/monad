export const DEFAULT_TTL_SECONDS = 30;
export const MAX_TTL_SECONDS = 900;
export const CHART_TTL_SECONDS = 180;

export interface TtlResult {
  seconds: number;
  clamped: boolean;
}

/**
 * Resolves a requested lifetime without silently exceeding the safety cap.
 *
 * ⛔⭐ **조용히 깎지 않는다 — «양쪽» 다.** 첫 판은 상한만 `clamped` 로 세고 음수는
 *    `Math.max(0, …)` 로 «말없이» 0 으로 만들었다. 그러면 TTL 0 = 즉시 만료라
 *    ***「그렸는데 안 보인다」***가 되고, 그 원인이 어디에도 안 남는다.
 * 🔑 이 원장의 존재 이유가 「그렸다 ↔ 보인다」를 «가르는» 것이므로, 그 갈림을 만드는
 *    값 변경은 «반드시» 이름을 달고 나가야 한다.
 * ⛔ NaN 도 「깎았다」로 낸다 — 비교가 조용히 false 를 내며 NaN 이 그대로 흐르는 것을 막는다.
 */
export function resolveTtl(requestedSeconds = DEFAULT_TTL_SECONDS): TtlResult {
  if (!Number.isFinite(requestedSeconds)) return { seconds: DEFAULT_TTL_SECONDS, clamped: true };
  const seconds = Math.max(0, Math.min(requestedSeconds, MAX_TTL_SECONDS));
  return { seconds, clamped: seconds !== requestedSeconds };
}
