import {
  intakeAction,
  intakeReviewWidget,
  type DeclarativeQuestionSpec,
  type WidgetSpec,
} from '../ui/declarative/index.js';

export interface IntakeReviewItemLike {
  kind: string;
  text: string;
}

export interface IntakeReviewQuestionLike {
  id: string;
  question: string;
  reason: string;
  /** Optional context fields preserved from upstream clarify pipeline.
   *  Ignored by mapping helpers but allowed so callers can pass the
   *  raw clarify-question row straight through. */
  scope?: string;
  itemId?: string | null;
}

export interface IntakeReviewActionLike {
  label: string;
  value: unknown;
}

export interface IntakeReviewDraftLike {
  title: string;
  summary: string;
  items: readonly IntakeReviewItemLike[];
  openQuestions: readonly IntakeReviewQuestionLike[];
}

export interface IntakeReviewSpecInput {
  intakeId: string;
  state: string;
  draft?: IntakeReviewDraftLike | null;
  decisionMode?: string | null;
  proposalObjective?: string | null;
  actions?: readonly IntakeReviewActionLike[];
}

export function buildIntakeReviewSummaryBody(input: IntakeReviewSpecInput): string {
  const lines = [
    `Intake: ${input.intakeId}`,
    `State: ${input.state}`,
  ];
  if (input.draft) {
    lines.push(`Title: ${input.draft.title}`);
    lines.push(`Summary: ${input.draft.summary}`);
    if (input.draft.items.length > 0) {
      lines.push('');
      lines.push('Items:');
      for (const item of input.draft.items.slice(0, 5)) {
        lines.push(`- [${item.kind}] ${item.text}`);
      }
      if (input.draft.items.length > 5) lines.push(`- … ${input.draft.items.length - 5} more`);
    }
  }
  if (input.decisionMode) {
    lines.push('');
    lines.push(`Decision: ${input.decisionMode}`);
  }
  if (input.proposalObjective) {
    lines.push('');
    lines.push(`Objective: ${input.proposalObjective}`);
  }
  return lines.join('\n');
}

/** Map an `IntakeReviewQuestionLike[]` into the declarative
 *  question shape the intake-review widget renderer consumes.
 *  Public alias of the internal helper so callers (and tests)
 *  can drive the mapping without re-creating the widget spec. */
export function mapIntakeReviewQuestions(
  questions: readonly IntakeReviewQuestionLike[],
): readonly DeclarativeQuestionSpec[] {
  return questions.map((question) => ({
    id: question.id,
    title: question.question,
    inputType: {
      placeholder: question.reason || 'Add the missing context',
    },
  }));
}

/** Stable shape adapter — wraps an action's `label` for display and
 *  preserves the whole input object as `value` so downstream
 *  dispatchers can pattern-match on `kind` / extra metadata. */
export function mapIntakeReviewActions<A extends { label: string }>(
  actions: readonly A[],
): ReadonlyArray<{ label: string; value: A }> {
  return actions.map((action) => ({
    label: action.label,
    value: action,
  }));
}

// Internal alias kept for in-module callers (widget assembly below).
const mapClarifyQuestions = mapIntakeReviewQuestions;

export function buildIntakeReviewWidgetSpec(
  input: IntakeReviewSpecInput,
): WidgetSpec {
  const body = buildIntakeReviewSummaryBody(input);
  if (input.draft?.openQuestions.length) {
    return intakeReviewWidget(`Clarify intake · ${input.intakeId}`)
      .setBody(body)
      .setQuestions(mapClarifyQuestions(input.draft.openQuestions))
      .build();
  }
  return intakeReviewWidget(`Review intake · ${input.intakeId}`)
    .setBody(body)
    .setActions(input.actions && input.actions.length > 0
      ? input.actions.slice(0, 3).map((action) => (
          intakeAction(action.label, action.value)
        ))
      : ['Close'])
    .build();
}
