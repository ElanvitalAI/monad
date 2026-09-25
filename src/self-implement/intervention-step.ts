import type { BrainSuggestionAction } from './auto-intervene.js';
import {
  describeIntervention,
  type InterventionDescriptor,
  type InterventionDescriptorInput,
} from './intervention-descriptor.js';
import { mapBrainAction } from './supervision-vocabulary.js';

export type ScreenComparison = 'first' | 'same' | 'changed';

export interface InterventionStepInput {
  readonly screen: string;
  /** `null` denotes the first sample; a prior step remains present even when its screen is empty. */
  readonly previous: InterventionStep | null;
  /** The caller owns the stopping policy; this pure step only applies its supplied threshold. */
  readonly stopAfterSameScreens: number;
  readonly descriptor: Omit<InterventionDescriptorInput, 'nextAction' | 'reason' | 'supervisionVerdict'>;
}

export interface InterventionStep extends InterventionDescriptor {
  readonly screen: string;
  readonly screenComparison: ScreenComparison;
  readonly sameScreenCount: number;
  /** A pure recommendation; the caller owns whether to stop. */
  readonly recommendsStop: boolean;
}

function comparisonFor(previous: InterventionStep | null, screen: string): ScreenComparison {
  if (previous === null) return 'first';
  // Exact comparison keeps whitespace meaningful: terminal whitespace can carry cursor or prompt state.
  return previous.screen === screen ? 'same' : 'changed';
}

function nextActionFor(shouldStop: boolean): BrainSuggestionAction {
  return shouldStop ? 'no-progress' : 'wait';
}

function validateStopAfterSameScreens(stopAfterSameScreens: number): void {
  if (!Number.isFinite(stopAfterSameScreens) || !Number.isInteger(stopAfterSameScreens) || stopAfterSameScreens < 1) {
    throw new RangeError('stopAfterSameScreens must be a finite positive integer');
  }
}

/**
 * Makes one deterministic intervention decision from a screen and the preceding decision.
 * It neither reads nor writes external state; callers retain the returned value for the next step.
 */
export function decideInterventionStep(input: InterventionStepInput): InterventionStep {
  validateStopAfterSameScreens(input.stopAfterSameScreens);
  const screenComparison = comparisonFor(input.previous, input.screen);
  const sameScreenCount = screenComparison === 'same'
    ? input.previous!.sameScreenCount + 1
    : 1;
  const recommendsStop = sameScreenCount >= input.stopAfterSameScreens;
  const nextAction = nextActionFor(recommendsStop);
  const supervisionVerdict = mapBrainAction(nextAction, recommendsStop);
  const reason = screenComparison === 'first'
    ? 'first screen observation'
    : screenComparison === 'same'
      ? `same screen observed ${sameScreenCount} times`
      : 'screen changed since the prior decision';

  return {
    ...describeIntervention({ ...input.descriptor, nextAction, reason, supervisionVerdict }),
    screen: input.screen,
    screenComparison,
    sameScreenCount,
    recommendsStop,
  };
}
