/** Two observed carry-overs distinguish a structural rework drift from a one-round coincidence. */
export const REWORK_FINDING_PERSISTENCE_DRIFT_THRESHOLD = 2;

export interface ReworkVerdictReview {
  readonly round: number;
  readonly mustFixCount: number;
  readonly findingIds: readonly string[] | null;
  readonly reviewVerdict: string | null;
}

export type ReworkDriftVerdict = 'drift' | 'no-drift' | 'unmeasurable';

export interface ReworkDriftVerdictResult {
  readonly verdict: ReworkDriftVerdict;
  readonly reason: 'no-review-rounds' | 'insufficient-review-rounds' | 'finding-ids-unavailable' | 'review-verdict-unavailable' | 'persistent-must-fix' | 'no-persistent-must-fix';
  readonly persistentFindingIds: readonly string[];
  readonly maximumPersistenceCount: number | null;
}

function mustFixFindingIds(review: ReworkVerdictReview): readonly string[] | null {
  if (review.findingIds === null || review.findingIds.length < review.mustFixCount) return null;
  return review.findingIds.slice(0, review.mustFixCount);
}

/**
 * Detect recurring must-fix findings from canonical review observations. Pure and deterministic;
 * this creates a recommendation only and never changes a ledger, run, or PR.
 */
export function detectReworkDrift(
  reviews: readonly ReworkVerdictReview[],
  threshold: number = REWORK_FINDING_PERSISTENCE_DRIFT_THRESHOLD,
): ReworkDriftVerdictResult {
  if (reviews.length === 0) return { verdict: 'unmeasurable', reason: 'no-review-rounds', persistentFindingIds: [], maximumPersistenceCount: null };
  if (reviews.length < 2) return { verdict: 'unmeasurable', reason: 'insufficient-review-rounds', persistentFindingIds: [], maximumPersistenceCount: null };

  const ordered = [...reviews].sort((left, right) => left.round - right.round);
  const findings = ordered.map(mustFixFindingIds);
  if (findings.some((value) => value === null)) {
    return { verdict: 'unmeasurable', reason: 'finding-ids-unavailable', persistentFindingIds: [], maximumPersistenceCount: null };
  }
  if (ordered.some(({ reviewVerdict }) => reviewVerdict === null)) {
    return { verdict: 'unmeasurable', reason: 'review-verdict-unavailable', persistentFindingIds: [], maximumPersistenceCount: null };
  }

  const streaks = new Map<string, number>();
  const qualifyingFindingIds = new Set<string>();
  let maximumPersistenceCount = 0;
  let previous = new Set(findings[0]!);
  for (let index = 1; index < findings.length; index += 1) {
    const current = new Set(findings[index]!);
    for (const findingId of current) {
      const streak = previous.has(findingId) ? (streaks.get(findingId) ?? 0) + 1 : 0;
      streaks.set(findingId, streak);
      maximumPersistenceCount = Math.max(maximumPersistenceCount, streak);
      if (streak >= threshold) qualifyingFindingIds.add(findingId);
    }
    previous = current;
  }
  const persistentFindingIds = [...qualifyingFindingIds].sort();
  return persistentFindingIds.length
    ? { verdict: 'drift', reason: 'persistent-must-fix', persistentFindingIds, maximumPersistenceCount }
    : { verdict: 'no-drift', reason: 'no-persistent-must-fix', persistentFindingIds: [], maximumPersistenceCount };
}

/** Human-facing advice only; automatic execution is intentionally excluded (HITL). */
export function buildReworkDriftRecommendation(result: ReworkDriftVerdictResult): string {
  if (result.verdict === 'drift') return `Recurring must-fix findings crossed the persistence threshold (${result.persistentFindingIds.join(', ')}). Recommendation: inspect the rework plan before another round. (No automatic action; HITL.)`;
  if (result.verdict === 'no-drift') return 'No must-fix finding crossed the persistence threshold. Recommendation: continue normal review observation. (No automatic action; HITL.)';
  return 'Finding persistence cannot be measured from this ledger. Recommendation: retain the unknown state until comparable reviewed rounds are available. (No automatic action; HITL.)';
}
