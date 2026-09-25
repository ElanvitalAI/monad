import type { IntakeDecision, IntakeDraft, IntakeItemDraft } from './types.js';

export type ClarifyIntent = 'apply-now' | 'backlog-only' | 'review-later' | 'unknown';

function applyIntentToItem(
  item: IntakeItemDraft,
  intent: ClarifyIntent,
  itemId?: string,
): IntakeItemDraft {
  if (itemId && item.id !== itemId) return item;
  if (intent === 'backlog-only') {
    return {
      ...item,
      needsClarification: false,
      proposedAction: 'keep-as-note',
    };
  }
  if (intent === 'apply-now') {
    return {
      ...item,
      needsClarification: false,
      proposedAction: 'task-create',
    };
  }
  if (intent === 'review-later') {
    return {
      ...item,
      needsClarification: false,
      proposedAction: 'keep-as-note',
    };
  }
  return item;
}

export function inferClarifyIntent(answer: string): ClarifyIntent {
  const lower = answer.toLowerCase();
  if (
    lower.includes('backlog')
    || lower.includes('later')
    || lower.includes('keep as note')
    || lower.includes('note only')
    || lower.includes('보류')
    || lower.includes('나중')
    || lower.includes('메모')
    || lower.includes('백로그')
  ) return 'backlog-only';
  if (
    lower.includes('apply')
    || lower.includes('task')
    || lower.includes('create')
    || lower.includes('implement')
    || lower.includes('do it')
    || lower.includes('now')
    || lower.includes('바로')
    || lower.includes('구현')
    || lower.includes('태스크')
  ) return 'apply-now';
  if (
    lower.includes('review')
    || lower.includes('hold')
    || lower.includes('decide later')
    || lower.includes('검토')
  ) return 'review-later';
  return 'unknown';
}

export function applyClarifyAnswerToDraft(
  draft: IntakeDraft,
  questionId: string,
  answer: string,
): {
  draft: IntakeDraft;
  intent: ClarifyIntent;
} | null {
  const question = draft.openQuestions.find((item) => item.id === questionId);
  if (!question) return null;
  const intent = inferClarifyIntent(answer);
  const items = draft.items.map((item) => applyIntentToItem(item, intent, question.itemId));
  const openQuestions = draft.openQuestions.filter((item) => item.id !== questionId);
  const suggestedMode = intent === 'backlog-only'
    ? 'backlog-capture'
    : intent === 'apply-now'
      ? 'task-creation'
      : draft.suggestedMode;
  return {
    intent,
    draft: {
      ...draft,
      summary: `${draft.summary} Clarified ${questionId}: ${answer}`.trim(),
      items,
      openQuestions,
      suggestedMode,
      confidence: Math.min(0.99, draft.confidence + 0.05),
    },
  };
}

export function buildDecisionFromIntent(
  intakeId: string,
  draft: IntakeDraft,
  clarifiedAnswers: Record<string, string | boolean>,
  intent: ClarifyIntent,
  previousMode?: IntakeDecision['mode'],
): IntakeDecision {
  const approvedItemIds = intent === 'backlog-only'
    ? []
    : draft.items.map((item) => item.id);
  const deferredItemIds = intent === 'backlog-only'
    ? draft.items.map((item) => item.id)
    : [];
  const mode = intent === 'apply-now'
    ? 'apply-now'
    : intent === 'backlog-only'
      ? 'backlog-only'
      : previousMode ?? 'review-later';
  return {
    intakeId,
    mode,
    approvedItemIds,
    deferredItemIds,
    clarifiedAnswers,
  };
}
