import { describe, expect, test } from 'bun:test';
import { commonTermCoverageWeight } from '../../src/autopilot/mission-codebase-gate.js';

describe('commonTermCoverageWeight', () => {
  test('keeps a dense common term as a non-zero coverage signal', () => {
    expect(commonTermCoverageWeight(14)).toBeGreaterThan(0);
  });

  test('keeps a one-line common-term hit below a dense match and normal coverage', () => {
    const incidental = commonTermCoverageWeight(1);
    const dense = commonTermCoverageWeight(14);

    expect(incidental).toBeGreaterThan(0);
    expect(incidental).toBeLessThan(dense);
    expect(dense).toBeLessThan(1);
  });
});
