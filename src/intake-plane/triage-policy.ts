// Triage policy — decides when an IntakeDraft is routed to a TriageRoom.
// Cascade-zyu W3 Z1.

import type { IntakeDraft, IntakeItemDraft } from './types.js';
import type { TriageTrigger } from './triage-room.js';

export interface TriagePolicy {
  id: string;
  /** Whole-draft confidence threshold (0-1). Drafts below this trigger. */
  draftConfidenceCeiling: number;
  /** `ask-user` items always trigger — even when overall confidence is high. */
  askUserAlwaysTriggers: boolean;
}

export const DEFAULT_TRIAGE_POLICY: TriagePolicy = {
  id: 'default-v1',
  draftConfidenceCeiling: 0.5,
  askUserAlwaysTriggers: true,
};

export interface TriageEvaluation {
  trigger: TriageTrigger | null;
  /** Items that flagged into the triage room (subset of `draft.items`). */
  flaggedItems: readonly IntakeItemDraft[];
}

function itemFlagsTriage(item: IntakeItemDraft, policy: TriagePolicy): boolean {
  if (item.needsClarification) return true;
  if (item.proposedAction === 'ask-user' && policy.askUserAlwaysTriggers) return true;
  if (item.kind === 'unknown') return true;
  return false;
}

export function evaluateTriage(
  draft: IntakeDraft,
  policy: TriagePolicy = DEFAULT_TRIAGE_POLICY,
): TriageEvaluation {
  const flaggedItems = draft.items.filter((it) => itemFlagsTriage(it, policy));
  const lowConfidence = draft.confidence < policy.draftConfidenceCeiling;
  const shouldTriage = lowConfidence || flaggedItems.length > 0;
  if (!shouldTriage) return { trigger: null, flaggedItems: [] };
  return {
    trigger: {
      policyId: policy.id,
      confidence: draft.confidence,
      flaggedItemCount: flaggedItems.length,
    },
    flaggedItems: flaggedItems.length > 0 ? flaggedItems : draft.items,
  };
}
