// ── Esc·Esc → /rewind 제스처 판정 (codex backtrack 동형) ─────────────
//
// TUI 부활 후속 (2026-07-12). codex 의 backtrack 상태머신(app_backtrack.rs:
// 첫 Esc 가 prime → 다음 Esc 가 transcript 오버레이)을 elanous 식으로 축약:
// **빈 입력 버퍼**에서 Esc 를 창(window) 안에 두 번 누르면 /rewind 픽커.
//
// codex 와의 차이(의도): codex 는 prime 을 다른 키 입력이 해제하는
// 상태머신이지만, elanous 의 textInput 은 host 에 모든 키를 노출하지 않으므로
// **시간 창(기본 1.5s)** 으로 stale prime 을 자연 소멸시킨다. 버퍼가
// 비어있지 않으면 절대 prime 하지 않는다 — Esc 의 기존 의미(버퍼 클리어)
// 보존. rich 모드에선 Esc 가 입력 루프를 이탈하므로 제스처는 사실상
// essential(chat-only) 전용 — 의도된 경계.

export interface EscEscDecision {
  /** 'open' = 픽커 오픈(consumed) · 'prime' = 1차 Esc 기록 · 'pass' = 기본 동작. */
  action: 'open' | 'prime' | 'pass';
  /** 다음 호출에 넘길 prime 타임스탬프 (0 = 해제). */
  nextPrimedAt: number;
}

export const ESC_ESC_WINDOW_MS = 1500;

export function resolveEscEscRewind(input: {
  bufferText: string;
  nowMs: number;
  primedAtMs: number;
  windowMs?: number;
}): EscEscDecision {
  const windowMs = input.windowMs ?? ESC_ESC_WINDOW_MS;
  if (input.bufferText.trim() !== '') {
    // 버퍼에 내용이 있으면 Esc 는 기존 의미(클리어) — prime 도 해제.
    return { action: 'pass', nextPrimedAt: 0 };
  }
  if (input.primedAtMs > 0 && input.nowMs - input.primedAtMs <= windowMs) {
    return { action: 'open', nextPrimedAt: 0 };
  }
  return { action: 'prime', nextPrimedAt: input.nowMs };
}
