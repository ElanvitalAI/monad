import { describe, expect, test } from 'bun:test';
import type { ControlStance } from '../pty-shell/pty-control-stance.js';
import {
  decideInterventionStep,
  type InterventionStep,
  type InterventionStepInput,
} from './intervention-step.js';

function input(
  screen: string,
  previous: InterventionStep | null = null,
  controlStance: ControlStance = 'owned',
): InterventionStepInput {
  return {
    screen,
    previous,
    stopAfterSameScreens: 2,
    descriptor: { level: 'L3', controlStance, draft: 'continue' },
  };
}

describe('decideInterventionStep', () => {
  test('distinguishes the first step instead of treating it as an equal screen', () => {
    const first = decideInterventionStep(input('prompt>'));

    expect(first.screenComparison).toBe('first');
    expect(first.sameScreenCount).toBe(1);
    expect(first.nextAction).toBe('wait');
    expect(first.recommendsStop).toBeFalse();
  });

  test('distinguishes the null first sample from a prior step with an empty screen', () => {
    const first = decideInterventionStep(input(''));
    const afterEmptyScreen = decideInterventionStep(input('prompt>', first));

    expect(first.screenComparison).toBe('first');
    expect(afterEmptyScreen.screenComparison).toBe('changed');
    expect(afterEmptyScreen.screenComparison).not.toBe(first.screenComparison);
  });

  test('uses the shared vocabulary mapping for its supervision verdict', () => {
    const first = decideInterventionStep(input('prompt>'));
    const stopped = decideInterventionStep(input('prompt>', first));

    expect(first.supervisionVerdict).toEqual({ verdict: 'continue' });
    expect(stopped.supervisionVerdict).toEqual({ verdict: 'escalate' });
  });

  test('applies a caller threshold of one to the first observation', () => {
    const first = decideInterventionStep({ ...input('prompt>'), stopAfterSameScreens: 1 });

    expect(first.screenComparison).toBe('first');
    expect(first.sameScreenCount).toBe(1);
    expect(first.nextAction).toBe('no-progress');
    expect(first.recommendsStop).toBeTrue();
    expect(first.supervisionVerdict).toEqual({ verdict: 'escalate' });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid caller threshold: %p',
    (stopAfterSameScreens) => {
      expect(() => decideInterventionStep({ ...input('prompt>'), stopAfterSameScreens })).toThrow(
        'stopAfterSameScreens must be a finite positive integer',
      );
    },
  );

  test('marks the second exact screen as no-progress and stops at the caller threshold', () => {
    const first = decideInterventionStep(input('prompt>'));
    const second = decideInterventionStep(input('prompt>', first));

    expect(second.screenComparison).toBe('same');
    expect(second.sameScreenCount).toBe(2);
    expect(second.reason).toBe('same screen observed 2 times');
    expect(second.nextAction).toBe('no-progress');
    expect(second.recommendsStop).toBeTrue();
    expect(second.supervisionVerdict).toEqual({ verdict: 'escalate' });
  });

  test('continues and resets the accumulated count when one character changes', () => {
    const first = decideInterventionStep(input('prompt>'));
    const stopped = decideInterventionStep(input('prompt>', first));
    const changed = decideInterventionStep(input('prompt!>', stopped));

    expect(changed.screenComparison).toBe('changed');
    expect(changed.sameScreenCount).toBe(1);
    expect(changed.nextAction).toBe('wait');
    expect(changed.recommendsStop).toBeFalse();
  });

  test('accumulates repeated screens without fixing the caller threshold', () => {
    const first = decideInterventionStep({ ...input('frozen'), stopAfterSameScreens: 4 });
    const second = decideInterventionStep({ ...input('frozen', first), stopAfterSameScreens: 4 });
    const third = decideInterventionStep({ ...input('frozen', second), stopAfterSameScreens: 4 });

    expect(second.sameScreenCount).toBe(2);
    expect(third.sameScreenCount).toBe(3);
    expect(third.recommendsStop).toBeFalse();
  });

  test('preserves descriptor ownership downgrades through describeIntervention', () => {
    const step = decideInterventionStep(input('prompt>', null, 'lost'));

    expect(step.level).toBe('L1');
    expect(step.downgradedFrom).toBe('L3');
  });

  test('is deterministic, immutable, serializable, and preserves whitespace as terminal screen content', () => {
    const previous = decideInterventionStep(input('prompt> '));
    const decisionInput = input('prompt>', previous);
    const inputBefore = structuredClone(decisionInput);
    const previousBefore = structuredClone(previous);
    Object.freeze(previous.supervisionVerdict);
    Object.freeze(previous);
    Object.freeze(decisionInput.descriptor);
    Object.freeze(decisionInput);

    const result = decideInterventionStep(decisionInput);

    expect(result.screenComparison).toBe('changed');
    expect(decisionInput).toEqual(inputBefore);
    expect(previous).toEqual(previousBefore);
    expect(result).toEqual(JSON.parse(JSON.stringify(result)));
    expect(decideInterventionStep(input('prompt>'))).toEqual(decideInterventionStep(input('prompt>')));
  });
});
