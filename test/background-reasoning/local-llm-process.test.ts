// Y2 local-llm slot abstraction · assign/release + role guard + pool helpers.

import { describe, expect, test } from 'bun:test';
import {
  LocalLLMPool,
  LocalLLMProcess,
  type LocalSlotAssignment,
} from '../../src/background-reasoning/local-llm-process';

const PATCHER_ASSIGN: LocalSlotAssignment = {
  nodeId: 'self',
  modelId: 'qwen-7b',
  baseUrl: 'http://127.0.0.1:1234/v1',
  role: 'patcher',
};

describe('LocalLLMProcess', () => {
  test('assign then release', () => {
    const slot = new LocalLLMProcess('s0');
    expect(slot.status()).toBe('free');
    slot.assign(PATCHER_ASSIGN);
    expect(slot.status()).toBe('assigned');
    expect(slot.role()).toBe('patcher');
    slot.release();
    expect(slot.status()).toBe('free');
    expect(slot.role()).toBeNull();
  });

  test('run executes and returns to assigned', async () => {
    const slot = new LocalLLMProcess('s0');
    slot.assign(PATCHER_ASSIGN);
    const out = await slot.run({
      role: 'patcher',
      input: 'log line',
      run: async (input, a) => `${a.modelId}:${input}`,
    });
    expect(out).toBe('qwen-7b:log line');
    expect(slot.status()).toBe('assigned');
  });

  test('rejects mismatched role', async () => {
    const slot = new LocalLLMProcess('s0');
    slot.assign(PATCHER_ASSIGN);
    await expect(
      slot.run({ role: 'thinker', input: 'x', run: async () => 'y' }),
    ).rejects.toThrow(/role=patcher/);
  });

  test('pause blocks run; resume restores', async () => {
    const slot = new LocalLLMProcess('s0');
    slot.assign(PATCHER_ASSIGN);
    slot.pause();
    expect(slot.status()).toBe('paused');
    await expect(slot.run({ role: 'patcher', input: 'x', run: async () => 'y' })).rejects.toThrow(/paused/);
    slot.resume();
    expect(slot.status()).toBe('assigned');
  });
});

describe('LocalLLMPool', () => {
  test('size guard', () => {
    expect(() => new LocalLLMPool({ size: 0 })).toThrow();
  });

  test('findFree returns first free slot', () => {
    const pool = new LocalLLMPool({ size: 2 });
    pool.all()[0]!.assign(PATCHER_ASSIGN);
    const free = pool.findFree();
    expect(free?.slotId()).toBe('slot-1');
  });

  test('findByRole locates assigned slot', () => {
    const pool = new LocalLLMPool({ size: 2 });
    pool.all()[1]!.assign(PATCHER_ASSIGN);
    expect(pool.findByRole('patcher')?.slotId()).toBe('slot-1');
    expect(pool.findByRole('thinker')).toBeNull();
  });

  test('pauseAll / resumeAll', () => {
    const pool = new LocalLLMPool({ size: 2 });
    pool.all()[0]!.assign(PATCHER_ASSIGN);
    pool.pauseAll();
    expect(pool.all()[0]!.status()).toBe('paused');
    expect(pool.all()[1]!.status()).toBe('paused');
    pool.resumeAll();
    expect(pool.all()[0]!.status()).toBe('assigned');
    expect(pool.all()[1]!.status()).toBe('free');
  });
});
