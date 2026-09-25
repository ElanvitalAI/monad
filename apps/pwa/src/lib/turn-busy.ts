export interface TurnBusyBanner {
  message: string;
  holder: string | null;
}

interface TurnBusyErrorPayload {
  error?: unknown;
  message?: unknown;
  holder?: unknown;
}

type TurnBusyBannerEvent =
  | { kind: 'error'; payload: unknown }
  | { kind: 'session-change' | 'turn-begin' | 'turn-end' };

/** Converts the daemon's turn-occupancy rejection into an inline banner model. */
export function parseTurnBusyBanner(payload: unknown): TurnBusyBanner | null {
  if (!payload || typeof payload !== 'object') return null;
  const { error, message, holder } = payload as TurnBusyErrorPayload;
  if (error !== 'turn_busy') return null;
  return {
    message: typeof message === 'string' ? message : 'This session is currently receiving input. Please try again when that turn finishes.',
    holder: typeof holder === 'string' && holder.trim() ? holder : null,
  };
}

/** Applies the banner lifetime policy without depending on rendering or clock state. */
export function reduceTurnBusyBanner(
  previous: TurnBusyBanner | null,
  event: TurnBusyBannerEvent,
): TurnBusyBanner | null {
  // ⛔ 2026-08-14 — 종전엔 «세 kind 를 나열해» 좁혔는데, Next 빌드의 tsc 가 그 자리에서
  //   유니온을 안 좁혀 `payload` 를 못 찾아 정적 빌드가 깨졌다(`bun test` 는 통과했다 —
  //   즉 두 컴파일 경로가 다르게 읽었다). 판별을 «부정형»으로 두면 어느 쪽이든 확정된다.
  //   동작은 같다: error 가 아니면 배너를 지우고, error 면 파싱해서 갱신한다.
  if (event.kind !== 'error') return null;
  return parseTurnBusyBanner(event.payload) ?? previous;
}
