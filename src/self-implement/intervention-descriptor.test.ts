import { describe, expect, test } from 'bun:test';
import type { BrainSuggestionAction } from './auto-intervene.js';
import {
  describeIntervention,
  INTERVENTION_LEVELS,
  type InterventionDescriptorInput,
  type InterventionLevel,
} from './intervention-descriptor.js';
import type { ControlStance } from '../pty-shell/pty-control-stance.js';
import type { SupervisionVerdict } from './supervision-vocabulary.js';

const stances: readonly ControlStance[] = ['owned', 'lost', 'unknown'];
const nextAction: BrainSuggestionAction = 'input';
const supervisionVerdict: SupervisionVerdict = { verdict: 'continue' };

function input(level: InterventionLevel, controlStance: ControlStance): InterventionDescriptorInput {
  return {
    level,
    controlStance,
    nextAction,
    reason: 'operator requested intervention',
    supervisionVerdict,
    draft: 'continue',
  };
}

describe('intervention descriptor', () => {
  test('exports the exact five-level intervention vocabulary', () => {
    expect(INTERVENTION_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
    expect(INTERVENTION_LEVELS).toHaveLength(5);
  });

  test.each(INTERVENTION_LEVELS.flatMap((level) => stances.map((controlStance) => [level, controlStance] as const)))
  ('describes level=%s with stance=%s across the complete 5×3 matrix', (level, controlStance) => {
    const descriptor = describeIntervention(input(level, controlStance));
    const shouldDowngrade = level !== 'L0' && level !== 'L1' && controlStance !== 'owned';

    expect(descriptor.level).toBe(shouldDowngrade ? 'L1' : level);
    expect(descriptor.controlStance).toBe(controlStance);
    expect(descriptor.nextAction).toBe(nextAction);
    expect(descriptor.reason).toBe('operator requested intervention');
    expect(descriptor.supervisionVerdict).toEqual(supervisionVerdict);
    expect('downgradedFrom' in descriptor).toBe(shouldDowngrade);
    if (shouldDowngrade) expect(descriptor.downgradedFrom).toBe(level);
    if (descriptor.level === 'L2' || descriptor.level === 'L3' || descriptor.level === 'L4') {
      expect(descriptor.draft).toBe('continue');
    }
  });

  test('defaults to the L2 draft level', () => {
    const descriptor = describeIntervention({
      controlStance: 'owned',
      nextAction,
      reason: 'default intervention',
      supervisionVerdict,
    });

    expect(descriptor).toEqual({
      level: 'L2',
      controlStance: 'owned',
      nextAction,
      reason: 'default intervention',
      supervisionVerdict,
      draft: '',
    });
  });

  test('is deterministic and survives a JSON round trip', () => {
    const descriptorInput = input('L3', 'lost');
    const descriptor = describeIntervention(descriptorInput);

    expect(describeIntervention(descriptorInput)).toEqual(descriptor);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  test('retains only the imported supervision verdict vocabulary', () => {
    const verdicts: readonly SupervisionVerdict[] = [
      { verdict: 'continue' },
      { verdict: 'assist', kind: 'context' },
      { verdict: 'escalate' },
      { verdict: 'abandon' },
      { verdict: 'complete' },
      { verdict: 'defer', until: '2026-08-17T00:00:00.000Z' },
    ];

    for (const supervisionVerdict of verdicts) {
      expect(describeIntervention({ ...input('L1', 'owned'), supervisionVerdict }).supervisionVerdict)
        .toEqual(supervisionVerdict);
    }
  });
});
