import { describe, expect, test } from 'bun:test';
import {
  buildIntakeDetailDeclarativeSpec,
  createIntakeDetailDeclarativeRuntimeArtifact,
} from '../src/intake-plane/http-declarative-view.js';
import type { IntakeDetail } from '../src/intake-plane/http-client.js';

function baseDetail(): IntakeDetail {
  return {
    intakeId: 'api-1',
    state: 'review-ready',
    source: 'api',
    receivedAt: '2026-04-30T12:00:00.000Z',
    updatedAt: '2026-04-30T12:00:00.000Z',
    actor: null,
    channelContext: null,
    draft: {
      title: 'compare two repos',
      summary: 'summary',
      itemCount: 1,
      openQuestionCount: 0,
      suggestedMode: 'task-creation',
      confidence: 0.91,
      items: [{
        id: 'item-1',
        kind: 'comparison',
        text: 'compare two repos',
        links: [],
        priorityHint: null,
        targetSurface: null,
        needsClarification: false,
        proposedAction: 'task-create',
      }],
      openQuestions: [],
    },
    decisionMode: null,
    scheduleText: null,
    decision: null,
    proposal: null,
    applyTokenPresent: false,
    nextActions: [{ kind: 'decide-apply-now', label: 'Apply now', intakeId: 'api-1', command: null }],
    raw: { text: 'compare two repos', transcriptSource: null, attachments: [] },
  };
}

describe('intake http declarative view', () => {
  test('builds review spec from daemon intake detail', () => {
    const spec = buildIntakeDetailDeclarativeSpec(baseDetail());
    expect(spec.type).toBe('intake-review');
    expect(String(spec.chrome?.title)).toContain('Review intake');
    expect((spec.config?.actions as Array<{ label: string }>)[0]?.label).toBe('Apply now');
  });

  test('builds clarify spec when daemon intake detail has open questions', () => {
    const detail = baseDetail();
    detail.state = 'clarifying';
    detail.draft!.openQuestions.push({
      id: 'q-1',
      scope: 'bundle',
      itemId: null,
      question: 'Keep this as backlog only?',
      reason: 'No actionable items were found.',
    });
    const spec = buildIntakeDetailDeclarativeSpec(detail);
    expect(spec.type).toBe('intake-review');
    expect((spec.config?.questions as Array<{ id: string }>)[0]?.id).toBe('q-1');
  });

  test('materializes a runtime artifact from daemon intake detail', () => {
    const artifact = createIntakeDetailDeclarativeRuntimeArtifact(baseDetail());
    expect(artifact.kind).toBe('view');
    if (artifact.kind === 'view') {
      expect(artifact.spec.type).toBe('intake-review');
    }
  });
});
