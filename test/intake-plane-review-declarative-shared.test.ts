import { describe, expect, test } from 'bun:test';

import {
  buildIntakeReviewSummaryBody,
  mapIntakeReviewActions,
  mapIntakeReviewQuestions,
} from '../src/intake-plane/review-declarative-shared.js';

describe('intake review declarative shared helpers', () => {
  test('builds a review body with decision and objective sections', () => {
    const body = buildIntakeReviewSummaryBody({
      intakeId: 'intake-1',
      state: 'review-ready',
      draft: {
        title: 'compare two repos',
        summary: 'summary',
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
      },
      decisionMode: 'backlog-only',
      proposalObjective: 'Compare both repos before implementation',
    });
    expect(body).toContain('Intake: intake-1');
    expect(body).toContain('Decision: backlog-only');
    expect(body).toContain('Objective: Compare both repos before implementation');
  });

  test('maps clarify questions into intake-review question configs', () => {
    const questions = mapIntakeReviewQuestions([{
      id: 'q-1',
      scope: 'bundle',
      itemId: null,
      question: 'Which repo should lead?',
      reason: 'Need ordering context',
    }]);
    expect(questions).toEqual([{
      id: 'q-1',
      title: 'Which repo should lead?',
      inputType: {
        placeholder: 'Need ordering context',
      },
    }]);
  });

  test('maps review actions into intake-review action configs', () => {
    const actions = mapIntakeReviewActions([{
      kind: 'decide-apply-now',
      label: 'Apply now',
      intakeId: 'intake-1',
      command: null,
    }]);
    expect(actions).toEqual([{
      label: 'Apply now',
      value: {
        kind: 'decide-apply-now',
        label: 'Apply now',
        intakeId: 'intake-1',
        command: null,
      },
    }]);
  });
});
