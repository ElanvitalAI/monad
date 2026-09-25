// ── PFC-S2 generalization: dispatchGoalKind ──
//
// Entry point — classify + route + return combined result. Caller
// (EnterAutoMode, ClassifyGoal tool, CLI) owns persistence (ACTIVE.md
// write) and follow-up orchestration.

import { classify } from './classifier.js';
import { selectAdapter } from './routing.js';
import type {
  AdapterResult,
  ClassifyInput,
  ClassifyResult,
  Intake,
  RouterDeps,
} from './types.js';

export interface DispatchInput extends ClassifyInput {
  goalSlug: string;
  /** Test seam + extension — replace individual adapters. */
  deps?: RouterDeps;
}

export interface DispatchResult {
  goalSlug: string;
  intake: Intake;
  classify: ClassifyResult;
  adapter: AdapterResult;
}

export async function dispatchGoalKind(
  input: DispatchInput,
): Promise<DispatchResult> {
  const classifyResult = await classify(input);
  const adapter = selectAdapter(classifyResult.kind, input.deps);
  const adapterResult = await adapter({
    goalSlug: input.goalSlug,
    intake: input.intake,
    classify: classifyResult,
    proposers: input.deps?.proposers,
  });
  return {
    goalSlug: input.goalSlug,
    intake: input.intake,
    classify: classifyResult,
    adapter: adapterResult,
  };
}
