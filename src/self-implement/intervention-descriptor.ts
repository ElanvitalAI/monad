import type { BrainSuggestionAction } from './auto-intervene.js';
import type { ControlStance } from '../pty-shell/pty-control-stance.js';
import type { SupervisionVerdict } from './supervision-vocabulary.js';

export const INTERVENTION_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type InterventionLevel = typeof INTERVENTION_LEVELS[number];

export interface InterventionDescriptorInput {
  readonly level?: InterventionLevel;
  readonly controlStance: ControlStance;
  readonly nextAction: BrainSuggestionAction;
  readonly reason: string;
  readonly supervisionVerdict: SupervisionVerdict;
  readonly draft?: string;
}

interface InterventionDescriptorBase {
  readonly level: InterventionLevel;
  readonly controlStance: ControlStance;
  readonly nextAction: BrainSuggestionAction;
  readonly reason: string;
  readonly supervisionVerdict: SupervisionVerdict;
}

export interface InterventionDescriptor extends InterventionDescriptorBase {
  readonly draft?: string;
  readonly downgradedFrom?: InterventionLevel;
}

function effectiveLevel(level: InterventionLevel, controlStance: ControlStance): InterventionLevel {
  return controlStance === 'owned' || level === 'L0' || level === 'L1' ? level : 'L1';
}

/** Builds a serializable description of one PTY intervention without reading or writing external state. */
export function describeIntervention(input: InterventionDescriptorInput): InterventionDescriptor {
  const requestedLevel = input.level ?? 'L2';
  const level = effectiveLevel(requestedLevel, input.controlStance);
  const base: InterventionDescriptorBase = {
    level,
    controlStance: input.controlStance,
    nextAction: input.nextAction,
    reason: input.reason,
    supervisionVerdict: input.supervisionVerdict,
  };

  if (level === 'L2' || level === 'L3' || level === 'L4') {
    return { ...base, level, draft: input.draft ?? '' };
  }
  if (level !== requestedLevel) {
    return { ...base, level, downgradedFrom: requestedLevel };
  }
  return { ...base, level };
}
