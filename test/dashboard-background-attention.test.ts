import { describe, expect, test } from 'bun:test';
import { computeBackgroundAttention } from '../src/dashboard/background-attention.js';

// Surface-unification v2.2 V2.2-5 (2026-05-11) — `scheduledJobs` input
// retired (scheduler view 폐기 · workflow runs 가 이미 같은 신호 cover).
const EMPTY = {
  agents: [],
  shells: [],
  workflows: [],
} as const;

describe('computeBackgroundAttention', () => {
  test('all-empty inputs → no attention', () => {
    const r = computeBackgroundAttention({ ...EMPTY });
    expect(r.needsInput).toBe(false);
    expect(r.planReady).toBe(false);
    expect(r.hasError).toBe(false);
    expect(r.any).toBe(false);
  });

  test('askUserActive=true triggers needsInput', () => {
    const r = computeBackgroundAttention({ ...EMPTY, askUserActive: true });
    expect(r.needsInput).toBe(true);
    expect(r.any).toBe(true);
  });

  test('agent attention.level=needs-input triggers needsInput', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      agents: [{ status: 'running', attention: { level: 'needs-input', message: 'q?' } }],
    });
    expect(r.needsInput).toBe(true);
    expect(r.any).toBe(true);
  });

  test('agent attention.level=error triggers hasError', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      agents: [{ status: 'running', attention: { level: 'error', message: 'boom' } }],
    });
    expect(r.hasError).toBe(true);
  });

  test('agent status=error triggers hasError', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      agents: [{ status: 'error' }],
    });
    expect(r.hasError).toBe(true);
  });

  test('shell completed with exitCode != 0 triggers hasError', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      shells: [{ status: 'completed', exitCode: 1 }],
    });
    expect(r.hasError).toBe(true);
  });

  test('shell completed with exitCode 0 → no error', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      shells: [{ status: 'completed', exitCode: 0 }],
    });
    expect(r.hasError).toBe(false);
  });

  test('shell killed → not treated as error (user-driven)', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      shells: [{ status: 'killed', exitCode: 137 }],
    });
    expect(r.hasError).toBe(false);
  });

  test('workflow status aborted/error triggers hasError', () => {
    const r1 = computeBackgroundAttention({ ...EMPTY, workflows: [{ status: 'aborted' }] });
    expect(r1.hasError).toBe(true);
    const r2 = computeBackgroundAttention({ ...EMPTY, workflows: [{ status: 'error' }] });
    expect(r2.hasError).toBe(true);
  });

  // Surface-unification v2.2 V2.2-5 (2026-05-11) — `scheduledJobs`
  // lastStatus error trigger retired. The same hasError signal now
  // comes from `workflows[*].status === 'error'` once a TOX schedule
  // (workflow `scheduleTrigger`) run fails.

  test('plan-mode active + steps > 0 → planReady', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      planMode: { active: true, stepCount: 3 },
    });
    expect(r.planReady).toBe(true);
    expect(r.any).toBe(true);
  });

  test('plan-mode active but stepCount=0 → not planReady', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      planMode: { active: true, stepCount: 0 },
    });
    expect(r.planReady).toBe(false);
  });

  test('plan-mode inactive → not planReady', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      planMode: { active: false, stepCount: 5 },
    });
    expect(r.planReady).toBe(false);
  });

  test('multiple triggers compose into any=true', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      agents: [{ status: 'running', attention: { level: 'needs-input', message: '' } }],
      shells: [{ status: 'completed', exitCode: 1 }],
      planMode: { active: true, stepCount: 2 },
    });
    expect(r.needsInput).toBe(true);
    expect(r.hasError).toBe(true);
    expect(r.planReady).toBe(true);
    expect(r.any).toBe(true);
  });

  test('done shell with no exitCode is not an error', () => {
    const r = computeBackgroundAttention({
      ...EMPTY,
      shells: [{ status: 'completed' }],
    });
    expect(r.hasError).toBe(false);
  });
});
