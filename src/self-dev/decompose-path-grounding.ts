import { assessSourcePaths, type SourcePathProbe } from '../autopilot/discovery/doc-staleness.js';

/** Non-blocking repository-path facts attached to one decomposed subtask. */
export interface DecomposePathGrounding {
  /** `no-candidates` is distinct from a completed check with zero missing paths. */
  candidateStatus: 'no-candidates' | 'checked' | 'unavailable';
  /** Number of repository source-path candidates that were eligible for checking. */
  candidateCount: number;
  /** Number of checked candidates that do not exist in the repository. */
  missingCount: number;
  /** Present only when filesystem inspection could not complete; never counted as missing. */
  reason?: string;
}

export interface DecomposePathGroundingOptions {
  repoRoot?: string;
  probe?: SourcePathProbe;
}

/**
 * Measures path claims in a decomposition fragment without changing its outcome.
 * Candidate extraction, de-duplication, root containment, and filesystem semantics
 * are delegated to the existing authoring-grounding implementation.
 */
export function groundDecomposePathClaims(
  feature: string,
  options: DecomposePathGroundingOptions = {},
): DecomposePathGrounding {
  const signals = assessSourcePaths(feature, 'src/self-dev/decompose.ts', options.repoRoot ?? process.cwd(), options.probe);
  if (signals.checked === 0) {
    return { candidateStatus: 'no-candidates', candidateCount: 0, missingCount: 0 };
  }
  if (signals.status === 'unavailable') {
    return {
      candidateStatus: 'unavailable',
      candidateCount: signals.checked,
      missingCount: signals.missing,
      reason: signals.reason,
    };
  }
  return {
    candidateStatus: 'checked',
    candidateCount: signals.checked,
    missingCount: signals.missing,
  };
}
