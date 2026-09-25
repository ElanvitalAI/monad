import {
  createDeclarativeRuntimeArtifact,
  type DeclarativeRuntimeArtifact,
  type DeclarativeRuntimeOptions,
  type WidgetSpec,
} from '../ui/declarative/index.js';
import { buildIntakeNextActions } from './presenter.js';
import { buildIntakeReviewWidgetSpec } from './review-declarative-shared.js';
import type { IntakeSession } from './types.js';

export function buildIntakeDeclarativeSpec(
  session: IntakeSession,
): WidgetSpec {
  const actions = buildIntakeNextActions(session, 'http');
  return buildIntakeReviewWidgetSpec({
    intakeId: session.intakeId,
    state: session.state,
    draft: session.draft ?? null,
    decisionMode: session.decision?.mode ?? null,
    proposalObjective: session.proposal?.objective ?? null,
    actions: actions.map((action) => ({
      label: action.label,
      value: action,
    })),
  });
}

export function createIntakeDeclarativeRuntimeArtifact(
  session: IntakeSession,
  options: DeclarativeRuntimeOptions = {},
): DeclarativeRuntimeArtifact {
  return createDeclarativeRuntimeArtifact(buildIntakeDeclarativeSpec(session), {
    prefer: options.prefer ?? 'view',
    ...(options.host ? { host: options.host } : {}),
    ...(options.viewDeps ? { viewDeps: options.viewDeps } : {}),
  });
}
