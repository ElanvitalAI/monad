import {
  createDeclarativeRuntimeArtifact,
  type DeclarativeRuntimeArtifact,
  type DeclarativeRuntimeOptions,
  type WidgetSpec,
} from '../ui/declarative/index.js';
import type { IntakeDetail } from './http-client.js';
import { buildIntakeReviewWidgetSpec } from './review-declarative-shared.js';

export function buildIntakeDetailDeclarativeSpec(
  detail: IntakeDetail,
): WidgetSpec {
  return buildIntakeReviewWidgetSpec({
    intakeId: detail.intakeId,
    state: detail.state,
    draft: detail.draft ?? null,
    decisionMode: detail.decisionMode ?? null,
    proposalObjective: detail.proposal?.objective ?? null,
    actions: detail.nextActions.map((action) => ({
      label: action.label,
      value: action,
    })),
  });
}

export function createIntakeDetailDeclarativeRuntimeArtifact(
  detail: IntakeDetail,
  options: DeclarativeRuntimeOptions = {},
): DeclarativeRuntimeArtifact {
  return createDeclarativeRuntimeArtifact(buildIntakeDetailDeclarativeSpec(detail), {
    prefer: options.prefer ?? 'view',
    ...(options.host ? { host: options.host } : {}),
    ...(options.viewDeps ? { viewDeps: options.viewDeps } : {}),
  });
}
