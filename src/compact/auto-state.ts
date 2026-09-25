// ── Wave 5 · auto-compact circuit breaker + verify-probe state ──
//
// Two pieces of process-local state that the chat loop reads/writes
// around each turn:
//
//   1) Consecutive auto-compact failures — when summarize() throws
//      or returns null three times in a row, the breaker trips and
//      auto-compact stops firing until the user manually clears it
//      via `/compact --reset` (Wave 6 follow-up).
//
//   2) Verify-probe opt-in — Gemini-style "did the summary lose
//      anything important?" check. Off by default because it's a
//      second LLM round-trip per compact.

const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveFailures = 0;
let breakerTripped = false;
let breakerReason = '';
let verifyProbeEnabled = false;

export function recordAutoCompactSuccess(): void {
  consecutiveFailures = 0;
  breakerTripped = false;
  breakerReason = '';
}

export function recordAutoCompactFailure(reason: string): {
  tripped: boolean;
  consecutive: number;
} {
  consecutiveFailures += 1;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    breakerTripped = true;
    breakerReason = reason;
  }
  return { tripped: breakerTripped, consecutive: consecutiveFailures };
}

export function isAutoCompactBreakerTripped(): boolean {
  return breakerTripped;
}

export function getAutoCompactBreakerReason(): string {
  return breakerReason;
}

export function resetAutoCompactBreaker(): void {
  consecutiveFailures = 0;
  breakerTripped = false;
  breakerReason = '';
}

export function setVerifyProbeEnabled(on: boolean): void {
  verifyProbeEnabled = on;
}

export function isVerifyProbeEnabled(): boolean {
  return verifyProbeEnabled;
}

/** Test-only — also re-exported through `index.ts` for production
 *  callers that need to clear state between runs (multi-session
 *  CLI). */
export function resetAutoCompactStateForTest(): void {
  consecutiveFailures = 0;
  breakerTripped = false;
  breakerReason = '';
  verifyProbeEnabled = false;
}
