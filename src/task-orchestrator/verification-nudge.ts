// ── Verification nudge (ROADMAP-agent-surface-deferred-tools Wave 4 · W4.3) ──
//
// Tracks consecutive task completions and emits a `<system-reminder>`
// snippet after the LLM has marked N tasks completed without an
// intervening review/verification step. Adapts the Claude-Code-fork
// pattern (`TaskUpdateTool.ts:333-349`) into monad's TOX runtime so
// large workflows don't reach "all complete" with zero acceptance
// proof.
//
// What counts as a "completion": a TaskUpdate that transitions a
// task's status to 'completed' (the TOX terminal-success state).
// 'failed' / 'cancelled' / 'superseded' DO reset the counter — they
// already trip alarms elsewhere and a verification reminder on a
// failure is noise.
//
// What counts as a "verification": any TaskUpdate where the patch
// includes an `appendNote` mentioning "verif" / "review" / "check"
// (case-insensitive substring) OR a status transition to 'review'.
// Heuristic — not exhaustive — but matches how monad tasks document
// acceptance: a one-line note + a 'review' lane transition.
//
// State is process-global (one counter shared by every TaskUpdate
// dispatch). The reset bar is intentionally low so a normal review
// rhythm zeroes the counter; tests can `resetVerificationNudge()` for
// isolation.

const REVIEW_KEYWORDS = /(?:verif|review|check|accept)/i;

export interface VerificationNudgeConfig {
  /** Threshold of consecutive completions before the nudge fires.
   *  Default 3 (Claude-Code-fork parity). */
  threshold: number;
}

const DEFAULT_CONFIG: VerificationNudgeConfig = { threshold: 3 };

let consecutiveCompletions = 0;
let config: VerificationNudgeConfig = { ...DEFAULT_CONFIG };

export function configureVerificationNudge(opts: Partial<VerificationNudgeConfig>): void {
  config = { ...DEFAULT_CONFIG, ...opts };
}

export function resetVerificationNudge(): void {
  consecutiveCompletions = 0;
  config = { ...DEFAULT_CONFIG };
}

/** Read-only peek for tests / debug panes. */
export function peekVerificationNudge(): {
  consecutive: number;
  threshold: number;
} {
  return { consecutive: consecutiveCompletions, threshold: config.threshold };
}

/** Result of folding one TaskUpdate dispatch into the nudge state. */
export interface NudgeFoldResult {
  /** New consecutive count after this event. */
  consecutive: number;
  /** When true, the caller should append `nudgeMessage` to the
   *  TaskUpdate result so the LLM sees the reminder on its next
   *  turn. Fires when `consecutive >= threshold` AND this event is
   *  itself a completion (i.e. the threshold was just crossed by
   *  THIS event). Does NOT keep firing on every subsequent
   *  completion — caller is expected to act on it. */
  shouldNudge: boolean;
  /** Pre-rendered reminder text — empty string when `shouldNudge` is
   *  false. */
  nudgeMessage: string;
}

/** Fold a TaskUpdate event into the nudge counter. `nextStatus` is
 *  the post-patch status string (any value — only 'completed' /
 *  'review' / 'failed' / 'cancelled' / 'superseded' branch). `note`
 *  is the patch.appendNote when present.
 *
 *  Effects:
 *   - `nextStatus === 'completed'`           → counter++ (may cross threshold)
 *   - `nextStatus === 'review'`              → counter = 0
 *   - other terminal failures + reviews     → counter = 0
 *   - `note` matches REVIEW_KEYWORDS         → counter = 0
 *   - anything else                          → counter unchanged
 */
export function foldVerificationNudge(input: {
  nextStatus: string;
  note?: string;
}): NudgeFoldResult {
  const reviewByNote = !!(input.note && REVIEW_KEYWORDS.test(input.note));
  const reviewByStatus =
    input.nextStatus === 'review' ||
    input.nextStatus === 'failed' ||
    input.nextStatus === 'cancelled' ||
    input.nextStatus === 'superseded';
  if (reviewByNote || reviewByStatus) {
    consecutiveCompletions = 0;
    return { consecutive: 0, shouldNudge: false, nudgeMessage: '' };
  }

  if (input.nextStatus === 'completed') {
    consecutiveCompletions += 1;
    if (consecutiveCompletions === config.threshold) {
      const nudge = renderNudge(consecutiveCompletions, config.threshold);
      // Counter intentionally stays at threshold so subsequent
      // completions DO NOT keep firing; reset comes from an actual
      // review step. (Threshold-equal check above gates the fire.)
      return {
        consecutive: consecutiveCompletions,
        shouldNudge: true,
        nudgeMessage: nudge,
      };
    }
    return {
      consecutive: consecutiveCompletions,
      shouldNudge: false,
      nudgeMessage: '',
    };
  }

  // Any other status (pending / blocked / scheduled / ready / running /
  // done — done isn't a TOX status but tolerant default) — no change.
  return {
    consecutive: consecutiveCompletions,
    shouldNudge: false,
    nudgeMessage: '',
  };
}

function renderNudge(count: number, threshold: number): string {
  return [
    `<system-reminder>`,
    `You have marked ${count} tasks 'completed' in a row without an intervening`,
    `review/verification step (threshold ${threshold}). Consider whether the work`,
    `actually satisfies its acceptance criteria — run the verifier, dispatch a`,
    `review-mode subagent (Agent + mode='plan'), or transition the next task to`,
    `'review' before continuing. To dismiss, mark the next task with appendNote`,
    `like "verified ..." or set its status to 'review'.`,
    `</system-reminder>`,
  ].join('\n');
}
