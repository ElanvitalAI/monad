import { describe, expect, test } from 'bun:test';
import { decideOutputArtifactWatchdog, type OutputArtifactSnapshot, type OutputWatchdogPolicy } from './output-artifact-watchdog.js';

const policy: OutputWatchdogPolicy = {
  required: ['goal', 'code', 'test'],
  deadlineMs: 100,
  exactNextAction: 'Create the missing test evidence, then rerun the focused test.',
  condensedContext: 'Prior child explored the driver but produced no code/test artifact.',
};
const at = (observedAtMs: number, goal = false, code = false, testEvidence = false): OutputArtifactSnapshot =>
  ({ observedAtMs, goal, code, test: testEvidence });

describe('output artifact watchdog', () => {
  test('a newly observed durable artifact resets the deadline', () => {
    const decision = decideOutputArtifactWatchdog({ previous: at(10, true), current: at(90, true, true), policy });
    expect(decision).toEqual({ kind: 'progress', deadlineAtMs: 190, newlyObserved: ['code'] });
  });

  test('waits before deadline while reporting exactly what remains', () => {
    const decision = decideOutputArtifactWatchdog({ previous: at(10, true), current: at(109, true), policy });
    expect(decision).toEqual({ kind: 'wait', deadlineAtMs: 110, missing: ['code', 'test'] });
  });

  test('emits durable diagnostic and exact restart packet after no-output deadline', () => {
    const decision = decideOutputArtifactWatchdog({ previous: at(10, true), current: at(110, true), policy });
    expect(decision.kind).toBe('intervene');
    if (decision.kind !== 'intervene') throw new Error('expected intervention');
    expect(decision.missing).toEqual(['code', 'test']);
    expect(decision.diagnostic).toContain('artifact deadline elapsed');
    expect(decision.restartPacket).toContain('NEXT ACTION: Create the missing test evidence');
    expect(decision.restartPacket).toContain('CONTEXT: Prior child explored the driver');
  });

  test('rejects terminal success when required artifacts are still absent', () => {
    const decision = decideOutputArtifactWatchdog({ previous: at(10), current: at(20, true), policy, terminalSuccess: true });
    expect(decision.kind).toBe('escalate-terminal-success');
    if (decision.kind !== 'escalate-terminal-success') throw new Error('expected terminal escalation');
    expect(decision.missing).toEqual(['code', 'test']);
    expect(decision.diagnostic).toContain('terminal-success rejected');
  });
});
