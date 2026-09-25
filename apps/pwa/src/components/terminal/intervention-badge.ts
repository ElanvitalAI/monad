import {
  describeIntervention,
  type InterventionLevel,
} from '../../../../../src/self-implement/intervention-descriptor';
import type { ControlStance } from '../../../../../src/pty-shell/pty-control-stance';

export interface InterventionBadgeInput {
  readonly level?: InterventionLevel;
  readonly controlStance?: ControlStance;
}

const DISPLAY_ACTION = 'input';
const DISPLAY_REASON = 'terminal badge display';
const DISPLAY_VERDICT = { verdict: 'continue' } as const;

/** Produces one terminal-ready intervention status line from supplied values only. */
export function interventionBadge(input: InterventionBadgeInput): string {
  if (!input.level || !input.controlStance) return '개입 수준: 미확인';

  const descriptor = describeIntervention({
    level: input.level,
    controlStance: input.controlStance,
    nextAction: DISPLAY_ACTION,
    reason: DISPLAY_REASON,
    supervisionVerdict: DISPLAY_VERDICT,
  });

  if (!descriptor.downgradedFrom) return `개입 수준: ${descriptor.level}`;

  const reason = descriptor.controlStance === 'lost' ? '제어 소유권 상실' : '제어 소유권 미확인';
  return `개입 수준: ${descriptor.level} (요청 ${descriptor.downgradedFrom}에서 강등: ${reason})`;
}
