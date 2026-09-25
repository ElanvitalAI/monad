// Self-implement child output watchdog: separates visible terminal activity from
// durable delivery artifacts (goal, code, test evidence).

export type OutputArtifact = 'goal' | 'code' | 'test';

export interface OutputArtifactSnapshot {
  readonly observedAtMs: number;
  readonly goal: boolean;
  readonly code: boolean;
  readonly test: boolean;
}

export interface OutputWatchdogPolicy {
  readonly required: readonly OutputArtifact[];
  readonly deadlineMs: number;
  readonly exactNextAction: string;
  readonly condensedContext: string;
}

export type OutputWatchdogDecision =
  | { readonly kind: 'progress'; readonly deadlineAtMs: number; readonly newlyObserved: readonly OutputArtifact[] }
  | { readonly kind: 'wait'; readonly deadlineAtMs: number; readonly missing: readonly OutputArtifact[] }
  | { readonly kind: 'intervene'; readonly missing: readonly OutputArtifact[]; readonly diagnostic: string; readonly restartPacket: string }
  | { readonly kind: 'escalate-terminal-success'; readonly missing: readonly OutputArtifact[]; readonly diagnostic: string; readonly restartPacket: string };

export function missingOutputArtifacts(snapshot: OutputArtifactSnapshot, required: readonly OutputArtifact[]): OutputArtifact[] {
  return required.filter((artifact) => !snapshot[artifact]);
}

function packet(policy: OutputWatchdogPolicy, missing: readonly OutputArtifact[]): string {
  return [
    `WATCHDOG: required artifacts missing: ${missing.join(', ')}`,
    `NEXT ACTION: ${policy.exactNextAction}`,
    `CONTEXT: ${policy.condensedContext}`,
  ].join('\n');
}

/**
 * A newly observed artifact renews the deadline.  Mere PTY output does not:
 * callers must supply durable artifact snapshots from the worktree/ledger.
 */
export function decideOutputArtifactWatchdog(input: {
  readonly previous: OutputArtifactSnapshot;
  readonly current: OutputArtifactSnapshot;
  readonly policy: OutputWatchdogPolicy;
  readonly terminalSuccess?: boolean;
}): OutputWatchdogDecision {
  const before = new Set(missingOutputArtifacts(input.previous, input.policy.required));
  const missing = missingOutputArtifacts(input.current, input.policy.required);
  const newlyObserved = input.policy.required.filter((artifact) => before.has(artifact) && !missing.includes(artifact));
  const restartPacket = packet(input.policy, missing);

  if (input.terminalSuccess && missing.length > 0) {
    return {
      kind: 'escalate-terminal-success', missing,
      diagnostic: `terminal-success rejected: required artifacts absent (${missing.join(', ')})`,
      restartPacket,
    };
  }
  if (newlyObserved.length > 0) {
    return { kind: 'progress', deadlineAtMs: input.current.observedAtMs + input.policy.deadlineMs, newlyObserved };
  }
  const deadlineAtMs = input.previous.observedAtMs + input.policy.deadlineMs;
  if (input.current.observedAtMs >= deadlineAtMs && missing.length > 0) {
    return {
      kind: 'intervene', missing,
      diagnostic: `artifact deadline elapsed without progress: ${missing.join(', ')}`,
      restartPacket,
    };
  }
  return { kind: 'wait', deadlineAtMs, missing };
}
