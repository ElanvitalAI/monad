export type ImplementationArtifactAxis = 'goal' | 'code' | 'test';

export interface ImplementationArtifactCompletenessInput {
  readonly goalDocumentAvailable: boolean;
  readonly changedFiles: readonly string[] | undefined;
  readonly gateExecuted: boolean;
  readonly gatePassed: boolean | undefined;
}

export interface ImplementationArtifactCompleteness {
  readonly complete: boolean;
  readonly missing: readonly ImplementationArtifactAxis[];
  readonly recoveryNote: string;
}

/**
 * A child completion is not delivery. Self-implement requires an authored goal,
 * a durable worktree diff, and test/gate evidence before it may leave the
 * bounded rework loop for review or PR preparation.
 */
export function assessImplementationArtifactCompleteness(
  input: ImplementationArtifactCompletenessInput,
): ImplementationArtifactCompleteness {
  const missing: ImplementationArtifactAxis[] = [];
  if (!input.goalDocumentAvailable) missing.push('goal');
  if (!input.changedFiles?.length) missing.push('code');
  if (!input.gateExecuted || input.gatePassed !== true) missing.push('test');
  return {
    complete: missing.length === 0,
    missing,
    recoveryNote: missing.length
      ? `Artifact output incomplete: missing ${missing.join(', ')}. Next action: create the missing durable artifact(s), then rerun the focused gate before claiming completion.`
      : '',
  };
}
