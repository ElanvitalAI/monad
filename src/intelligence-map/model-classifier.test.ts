import { describe, expect, test } from 'bun:test';

import {
  CLASSIFIER_TIMEOUT_CEILING_MS,
  CLASSIFIER_TIMEOUT_FLOOR_MS,
  CLASSIFIER_TIMEOUT_MS_PER_CHARACTER,
  type ClassifierTimer,
  classifyModelsFromText,
  classifyModelsFromTextDetailed,
} from './model-classifier.js';

const reply = JSON.stringify({
  models: [{ id: 'new-model', provider: 'openai', tier: 'better' }],
});

function controlledTimer(): {
  timer: ClassifierTimer;
  advance: (ms: number) => void;
  appliedMs: () => number | undefined;
} {
  let now = 0;
  let nextId = 0;
  let applied: number | undefined;
  const scheduled = new Map<number, { dueAt: number; callback: () => void }>();
  return {
    timer: {
      setTimeout(callback, ms) {
        applied = ms;
        const id = nextId++;
        scheduled.set(id, { dueAt: now + ms, callback });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout(handle) {
        scheduled.delete(handle as unknown as number);
      },
    },
    advance(ms) {
      now += ms;
      for (const [id, scheduledTimer] of [...scheduled]) {
        if (scheduledTimer.dueAt <= now) {
          scheduled.delete(id);
          scheduledTimer.callback();
        }
      }
    },
    appliedMs: () => applied,
  };
}

async function isSettled<T>(promise: Promise<T>): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; });
  await Promise.resolve();
  return settled;
}

describe('classifyModelsFromTextDetailed', () => {
  test('reports completed classification and keeps the candidate-array wrapper compatible', async () => {
    const runLlm = async () => reply;
    const detailed = await classifyModelsFromTextDetailed('model announcement', runLlm);

    expect(detailed.status).toBe('completed');
    expect(detailed.contentLength).toBe(18);
    expect(detailed.candidates.map((candidate) => candidate.id)).toEqual(['new-model']);
    expect(await classifyModelsFromText('model announcement', runLlm)).toEqual(detailed.candidates);
  });

  test('reports a deadline without throwing when the injected runner stalls', async () => {
    const detailed = await classifyModelsFromTextDetailed(
      'slow page',
      async () => new Promise<string>(() => {}),
      { timeoutMs: 10 },
    );

    expect(detailed.status).toBe('deadline');
    expect(detailed.candidates).toEqual([]);
    expect(detailed.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(detailed.contentLength).toBe(9);
    expect(detailed.timeoutMs).toBe(10);
    expect(detailed.error).toBe('model-classifier deadline after 10ms');
  });

  test.each([
    ['short', 'brief', CLASSIFIER_TIMEOUT_FLOOR_MS + 5 * CLASSIFIER_TIMEOUT_MS_PER_CHARACTER],
    ['long', 'x'.repeat(10_000), CLASSIFIER_TIMEOUT_FLOOR_MS + 10_000 * CLASSIFIER_TIMEOUT_MS_PER_CHARACTER],
    ['ceiling', 'x'.repeat(CLASSIFIER_TIMEOUT_CEILING_MS), CLASSIFIER_TIMEOUT_CEILING_MS],
  ])('keeps the computed %s deadline pending until its clock reaches the applied time', async (_name, body, expectedMs) => {
    const { timer, advance, appliedMs } = controlledTimer();
    const detailed = classifyModelsFromTextDetailed(
      body,
      async () => new Promise<string>(() => {}),
      { timer },
    );

    expect(appliedMs()).toBe(expectedMs);
    advance(expectedMs - 1);
    expect(await isSettled(detailed)).toBe(false);

    advance(1);
    await expect(detailed).resolves.toMatchObject({
      candidates: [],
      status: 'deadline',
      timeoutMs: expectedMs,
      error: `model-classifier deadline after ${expectedMs}ms`,
    });
  });

  test('increases the long-body deadline above the short-body floor without exceeding the ceiling', () => {
    const short = CLASSIFIER_TIMEOUT_FLOOR_MS + 5 * CLASSIFIER_TIMEOUT_MS_PER_CHARACTER;
    const long = CLASSIFIER_TIMEOUT_FLOOR_MS + 10_000 * CLASSIFIER_TIMEOUT_MS_PER_CHARACTER;

    expect(short).toBeGreaterThanOrEqual(CLASSIFIER_TIMEOUT_FLOOR_MS);
    expect(long).toBeGreaterThan(short);
    expect(CLASSIFIER_TIMEOUT_CEILING_MS).toBeGreaterThanOrEqual(long);
  });

  test('preserves an explicit caller timeout and uses the floor when body length is unavailable', async () => {
    const overridden = await classifyModelsFromTextDetailed('x'.repeat(CLASSIFIER_TIMEOUT_CEILING_MS), async () => reply, { timeoutMs: 37 });
    const unavailable = await classifyModelsFromTextDetailed(undefined as unknown as string, async () => reply);

    expect(overridden.timeoutMs).toBe(37);
    expect(unavailable).toMatchObject({
      candidates: [],
      status: 'completed',
      contentLength: 0,
      timeoutMs: CLASSIFIER_TIMEOUT_FLOOR_MS,
    });
  });

  test('reports a short error message without throwing when the injected runner rejects', async () => {
    const detailed = await classifyModelsFromTextDetailed(
      'broken page',
      async () => { throw new Error('runner unavailable for this source'); },
    );

    expect(detailed.status).toBe('error');
    expect(detailed.candidates).toEqual([]);
    expect(detailed.error).toBe('runner unavailable for this source');
    expect(detailed.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('records a runner error with the deadline text as an error rather than a deadline', async () => {
    const detailed = await classifyModelsFromTextDetailed(
      'misleading error page',
      async () => { throw new Error('model-classifier deadline'); },
    );

    expect(detailed).toMatchObject({
      candidates: [],
      status: 'error',
      error: 'model-classifier deadline',
    });
  });

  test.each([
    Object.create(null),
    { toString: () => { throw new Error('cannot stringify'); } },
  ])('records an unstringifiable thrown value as an error', async (thrown) => {
    const detailed = await classifyModelsFromTextDetailed(
      'broken page',
      () => { throw thrown; },
    );

    expect(detailed).toMatchObject({
      candidates: [],
      status: 'error',
      error: 'classifier error unavailable',
    });
  });
});
