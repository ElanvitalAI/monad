// REPL Ctrl-C double-tap decision — BACKLOG #3 (2026-05-05).
//
// Pure helper extracted from src/repl/index.ts so the policy is unit-
// testable without a real readline interface. The TTY loop calls
// `decideSigintAction(lastSigintAt, now)` on each Ctrl-C event and
// either re-prompts with a hint (first tap, idle prompt) or closes
// the readline (second tap within window).

/** Window during which a second Ctrl-C is interpreted as "exit"
 *  rather than starting a new tap-cycle. Tuned to match the
 *  familiar bash / fish behaviour where the user's reflex tap is
 *  ~500-1000ms apart. */
export const SIGINT_DOUBLE_TAP_MS = 1500;

export type SigintAction = 'exit' | 'hint';

/** Pure decision: given the timestamp of the previous SIGINT and
 *  the current one, return whether to exit or surface a hint.
 *
 *  - First tap (or window expired) → 'hint' (clear partial input,
 *    reprint prompt + advisory).
 *  - Second tap within `SIGINT_DOUBLE_TAP_MS` → 'exit' (close rl). */
export function decideSigintAction(
  lastSigintAt: number,
  now: number,
  windowMs: number = SIGINT_DOUBLE_TAP_MS,
): SigintAction {
  if (lastSigintAt > 0 && now - lastSigintAt < windowMs) return 'exit';
  return 'hint';
}
