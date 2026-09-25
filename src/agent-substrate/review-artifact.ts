import { createArtifactStore } from '../artifact/index.js';

export interface ReviewArtifactInput {
  readonly origin: string;
  readonly runId: string;
  readonly round: number;
  readonly verdict: string;
  readonly findings: readonly string[];
  readonly mustFix?: readonly string[];
  readonly shouldFix?: readonly string[];
  readonly summary?: string;
  readonly goalFile?: string;
}

export interface ReviewArtifactWriter {
  (input: ReviewArtifactInput): { path: string };
}

/** Persists complete review output; callers log only this returned path. */
export const persistReviewArtifact: ReviewArtifactWriter = (input) => {
  const body = JSON.stringify({
    runId: input.runId,
    round: input.round,
    verdict: input.verdict,
    findings: input.findings,
    ...(input.mustFix ? { mustFix: input.mustFix } : {}),
    ...(input.shouldFix ? { shouldFix: input.shouldFix } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.goalFile !== undefined ? { goalFile: input.goalFile } : {}),
  }, null, 2);
  return createArtifactStore().put('block', body, {
    origin: input.origin,
    producer: 'review-observation',
    tags: ['review', 'full-output'],
    description: `review ${input.verdict}, round ${input.round}`,
  });
};
