import { describe, expect, test } from 'bun:test';
import { hasGoalStepCodeName } from './goal-step-code-name.js';

describe('hasGoalStepCodeName', () => {
  test('recognizes source path tokens with known extensions, including basename-only paths', () => {
    expect(hasGoalStepCodeName('Wire src/self-implement/goal-author.ts into the observation.')).toBe(true);
    expect(hasGoalStepCodeName('Update packages/tool/index.tsx before verification.')).toBe(true);
    expect(hasGoalStepCodeName('Wire goal-author.ts into the observation.')).toBe(true);
  });

  test('recognizes camel and Pascal symbols at the minimum five-character boundary', () => {
    expect(hasGoalStepCodeName('Call runId to resolve the request.')).toBe(true);
    expect(hasGoalStepCodeName('Return RunId from the detector.')).toBe(true);
    expect(hasGoalStepCodeName('Call run to resolve the request.')).toBe(false);
    expect(hasGoalStepCodeName('Return Step from the detector.')).toBe(false);
  });

  test('rejects prose and general hyphenated compounds, including after prepositions', () => {
    expect(hasGoalStepCodeName('Run regression gate and audit the diff')).toBe(false);
    expect(hasGoalStepCodeName('Keep behavior in well-known environments')).toBe(false);
    expect(hasGoalStepCodeName('Load retries from fail-soft policy')).toBe(false);
    expect(hasGoalStepCodeName('Document behavior in source-path guidance')).toBe(false);
    expect(hasGoalStepCodeName('Document goal-author guidance')).toBe(false);
  });

  test('recognizes an explicitly quoted kebab module name', () => {
    expect(hasGoalStepCodeName('Propagate ledger verdict classifications in `run-store`')).toBe(true);
    expect(hasGoalStepCodeName('Read configuration from `run-store`')).toBe(true);
  });
});
