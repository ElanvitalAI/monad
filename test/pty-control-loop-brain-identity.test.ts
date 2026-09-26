import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { createLlmControlBrain } from '../src/autopilot/llm-control-brain.js';
import { runPtyControlLoop, type ControlDecision, type PtyControlDeps } from '../src/autopilot/pty-control-loop.js';

type BrainRecord = { category: string; event: string; data: Record<string, unknown> };

const originalRunId = process.env.ELANOUS_RUN_ID;
const originalPtyId = process.env.ELANOUS_PTY_ID;

afterEach(() => {
  if (originalRunId === undefined) delete process.env.ELANOUS_RUN_ID;
  else process.env.ELANOUS_RUN_ID = originalRunId;
  if (originalPtyId === undefined) delete process.env.ELANOUS_PTY_ID;
  else process.env.ELANOUS_PTY_ID = originalPtyId;
});

function captureBrainRecords(): { records: BrainRecord[]; restore: () => void } {
  const records: BrainRecord[] = [];
  const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'autopilot.control' && event === 'brain') records.push({ category, event, data: data ?? {} });
  }) as never);
  return { records, restore: () => log.mockRestore() };
}

function deps(extra: Partial<PtyControlDeps> = {}): PtyControlDeps {
  return {
    observe: () => 'child screen',
    inject: () => true,
    classify: () => 'working',
    sleep: async () => {},
    ...extra,
  };
}

function brainFor(actions: ControlDecision[]) {
  let index = 0;
  return createLlmControlBrain({
    goal: 'finish',
    stream: async () => JSON.stringify(actions[index++]!),
  });
}

describe('PTY control brain decision identity', () => {
  test('records each multi-step decision once with the caller-declared child and harness run while preserving the established record contract', async () => {
    process.env.ELANOUS_RUN_ID = 'run-declared-by-harness';
    process.env.ELANOUS_PTY_ID = 'pty-process-state-must-not-be-subject';
    const { records, restore } = captureBrainRecords();
    try {
      const result = await runPtyControlLoop(brainFor([
        { action: 'wait' },
        { action: 'wait' },
        { action: 'done', reason: 'complete' },
      ]), deps({ subjectPtyId: 'pty-child-declared-by-caller' }), { maxSteps: 4, pollMs: 0 });

      expect(result).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: 2 });
      expect(records).toHaveLength(3);
      expect(records).toEqual([
        { category: 'autopilot.control', event: 'brain', data: { step: 0, action: 'wait', state: 'working', subjectPtyId: 'pty-child-declared-by-caller', runId: 'run-declared-by-harness' } },
        { category: 'autopilot.control', event: 'brain', data: { step: 1, action: 'wait', state: 'working', subjectPtyId: 'pty-child-declared-by-caller', runId: 'run-declared-by-harness' } },
        { category: 'autopilot.control', event: 'brain', data: { step: 2, action: 'done', state: 'working', subjectPtyId: 'pty-child-declared-by-caller', runId: 'run-declared-by-harness' } },
      ]);
      expect(records.every(({ data }) => data.subjectPtyId !== process.env.ELANOUS_PTY_ID)).toBe(true);
    } finally {
      restore();
    }
  });

  test('without caller or harness identity still records the decision and preserves termination and step count without fabricating identity', async () => {
    delete process.env.ELANOUS_RUN_ID;
    delete process.env.ELANOUS_PTY_ID;
    const actions: ControlDecision[] = [{ action: 'wait' }, { action: 'done', reason: 'complete' }];
    const baseline = await runPtyControlLoop(brainFor(actions), deps(), { maxSteps: 3, pollMs: 0 });
    const { records, restore } = captureBrainRecords();
    try {
      const withoutIdentity = await runPtyControlLoop(brainFor(actions), deps(), { maxSteps: 3, pollMs: 0 });
      expect(withoutIdentity).toEqual(baseline);
      expect(withoutIdentity).toEqual({ termination: { kind: 'success', reason: 'complete' }, steps: 1 });
      expect(records).toEqual([
        { category: 'autopilot.control', event: 'brain', data: { step: 0, action: 'wait', state: 'working' } },
        { category: 'autopilot.control', event: 'brain', data: { step: 1, action: 'done', state: 'working' } },
      ]);
      expect(records.every(({ data }) => !('subjectPtyId' in data) && !('runId' in data))).toBe(true);
    } finally {
      restore();
    }
  });
});
