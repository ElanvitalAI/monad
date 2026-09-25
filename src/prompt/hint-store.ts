// Transient prompt-hint store — LLM self-modification (Phase D D12 /
// Phase F). ControlPromptAppend writes hints here; dashboard.ts
// assembles them into the next turn's system prompt.
//
// Scope semantics:
//   • 'turn'    — applied exactly once on the next turn, then cleared
//   • 'session' — applied every turn until dashboard restart or clear
//
// Persistence: none. The hints are intentionally process-local so
// a crash or restart wipes any LLM-authored prompt adjustments. This
// matches the "self-modify within one session" policy and makes
// audit simple.

export type HintScope = 'turn' | 'session';

export interface PromptHint {
  text: string;
  scope: HintScope;
  at: number;
  /** Free-form origin label (e.g. "control_prompt_append").
   *  Shows up in the audit log for Phase F. */
  origin?: string;
}

const hints: PromptHint[] = [];

export function appendPromptHint(hint: Omit<PromptHint, 'at'>): void {
  hints.push({ ...hint, at: Date.now() });
}

export function listPromptHints(): ReadonlyArray<PromptHint> {
  return hints;
}

/** Return concatenated hint text. Also GCs any `turn`-scoped hints
 *  because they fired this turn. Call once per turn, right before
 *  assembling the system prompt. */
export function drainPromptHintsForTurn(): string {
  const active = hints.map(h => h.text).filter(Boolean);
  // Drop turn-scope hints; keep session-scope ones.
  for (let i = hints.length - 1; i >= 0; i--) {
    if (hints[i]!.scope === 'turn') hints.splice(i, 1);
  }
  return active.join('\n\n');
}

export function clearPromptHints(scope?: HintScope): void {
  if (!scope) { hints.length = 0; return; }
  for (let i = hints.length - 1; i >= 0; i--) {
    if (hints[i]!.scope === scope) hints.splice(i, 1);
  }
}

export function _resetPromptHintsForTesting(): void {
  hints.length = 0;
}
