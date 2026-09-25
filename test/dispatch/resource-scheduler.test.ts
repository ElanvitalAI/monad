// Phase 2 D4 — ResourceScheduler unit tests.

import { describe, expect, test } from 'bun:test';

import {
  ResourceScheduler,
  type LocalLlmDecl,
  type TaskResourceRequirement,
} from '../../src/dispatch/resource-scheduler.ts';
import type { ResolvedSlot } from '../../src/dispatch/time-slot.ts';

const QWEN: LocalLlmDecl = {
  id: 'qwen-coder-72b',
  location: 'lmstudio',
  maxConcurrent: 1,
  capabilities: ['coding', 'reasoning'],
  estimatedTokensPerSec: 50,
};
const LLAMA: LocalLlmDecl = {
  id: 'llama-3.3-70b',
  location: 'ollama',
  maxConcurrent: 2,
  capabilities: ['chat', 'summarize', 'classify'],
  estimatedTokensPerSec: 40,
};

function slot(apiCost: 'allow' | 'prefer' | 'deny' = 'deny'): () => ResolvedSlot {
  return () => ({
    kind: 'sleep',
    policy: { noisyTasks: 'allow', longRunning: 'prefer', apiCost, pushFreq: 'suppress' },
    fromFallback: false,
  });
}

function req(over: Partial<TaskResourceRequirement> = {}): TaskResourceRequirement {
  return {
    taskId: 't-1',
    capabilities: ['coding'],
    ...over,
  };
}

describe('ResourceScheduler.tryReserve — local match', () => {
  test('reserves a matching model when free', () => {
    const s = new ResourceScheduler({ pool: [QWEN, LLAMA], slot: slot() });
    const out = s.tryReserve(req());
    expect(out.ok).toBe(true);
    expect(out.ok && out.kind).toBe('local');
    expect(out.ok && out.kind === 'local' && out.modelId).toBe('qwen-coder-72b');
  });

  test('honours preferredModelId when capabilities also match', () => {
    const s = new ResourceScheduler({ pool: [QWEN, LLAMA], slot: slot() });
    const out = s.tryReserve(req({ capabilities: ['chat'], preferredModelId: 'llama-3.3-70b' }));
    expect(out.ok && out.kind === 'local' && out.modelId).toBe('llama-3.3-70b');
  });

  test('preferredModelId mismatch falls back to no-match (with API deny)', () => {
    const s = new ResourceScheduler({ pool: [QWEN, LLAMA], slot: slot('deny') });
    const out = s.tryReserve(req({ capabilities: ['coding'], preferredModelId: 'llama-3.3-70b' }));
    expect(out.ok).toBe(false);
  });

  test('picks the higher-tps model on tie', () => {
    const FAST: LocalLlmDecl = { ...QWEN, id: 'fast-coder', estimatedTokensPerSec: 80 };
    const s = new ResourceScheduler({ pool: [QWEN, FAST], slot: slot() });
    const out = s.tryReserve(req({ capabilities: ['coding'] }));
    expect(out.ok && out.kind === 'local' && out.modelId).toBe('fast-coder');
  });
});

describe('ResourceScheduler.tryReserve — busy + queue', () => {
  test('returns all-busy when capacity full + API deny', () => {
    const s = new ResourceScheduler({ pool: [QWEN], slot: slot('deny') });
    s.tryReserve(req({ taskId: 't-1' }));
    const out = s.tryReserve(req({ taskId: 't-2' }));
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('all-busy');
  });

  test('busy + apiCost=allow → returns API fallback', () => {
    const s = new ResourceScheduler({ pool: [QWEN], slot: slot('allow') });
    s.tryReserve(req({ taskId: 't-1' }));
    const out = s.tryReserve(req({ taskId: 't-2' }));
    expect(out.ok && out.kind).toBe('api');
  });

  test('release pumps the queue', async () => {
    const s = new ResourceScheduler({ pool: [QWEN], slot: slot('deny') });
    s.tryReserve(req({ taskId: 't-1' }));
    const waiting = s.enqueue(req({ taskId: 't-2' }));
    s.release('t-1');
    const out = await waiting;
    expect(out.ok && out.kind).toBe('local');
  });

  test('respects per-model maxConcurrent ceiling', () => {
    const s = new ResourceScheduler({ pool: [LLAMA], slot: slot('deny') });
    expect(s.tryReserve(req({ taskId: 't-1', capabilities: ['chat'] })).ok).toBe(true);
    expect(s.tryReserve(req({ taskId: 't-2', capabilities: ['chat'] })).ok).toBe(true);
    expect(s.tryReserve(req({ taskId: 't-3', capabilities: ['chat'] })).ok).toBe(false);
  });
});

describe('ResourceScheduler.tryReserve — API gating', () => {
  test('no local match + apiCost=deny → fail', () => {
    const s = new ResourceScheduler({ pool: [LLAMA], slot: slot('deny') });
    const out = s.tryReserve(req({ capabilities: ['coding'] }));
    expect(out.ok).toBe(false);
  });

  test('no local match + apiCost=allow → API fallback', () => {
    const s = new ResourceScheduler({ pool: [LLAMA], slot: slot('allow') });
    const out = s.tryReserve(req({ capabilities: ['vision'] }));
    expect(out.ok && out.kind).toBe('api');
  });

  test('apiFallbackAllowed=false vetoes the API fallback even when policy allows', () => {
    const s = new ResourceScheduler({ pool: [LLAMA], slot: slot('allow') });
    const out = s.tryReserve(req({ capabilities: ['vision'], apiFallbackAllowed: false }));
    expect(out.ok).toBe(false);
  });
});

describe('ResourceScheduler.inspect / reset', () => {
  test('inspect reflects assignments + queue', () => {
    const s = new ResourceScheduler({ pool: [QWEN], slot: slot('deny') });
    s.tryReserve(req({ taskId: 't-1' }));
    s.enqueue(req({ taskId: 't-2' }));
    const view = s.inspect();
    expect(view.modelInUse['qwen-coder-72b']).toBe(1);
    expect(view.queuedTasks).toBe(1);
    expect(view.reservationsByTask['t-1']).toBe('qwen-coder-72b');
  });

  test('reset releases everything and rejects queued jobs', async () => {
    const s = new ResourceScheduler({ pool: [QWEN], slot: slot('deny') });
    s.tryReserve(req({ taskId: 't-1' }));
    const waiting = s.enqueue(req({ taskId: 't-2' }));
    s.reset();
    const out = await waiting;
    expect(out.ok).toBe(false);
    expect(s.inspect().queuedTasks).toBe(0);
  });
});

describe('ResourceScheduler.release', () => {
  test('returns false for unknown taskId', () => {
    const s = new ResourceScheduler({ pool: [QWEN] });
    expect(s.release('nope')).toBe(false);
  });

  test('frees capacity for the same model', () => {
    const s = new ResourceScheduler({ pool: [QWEN], slot: slot('deny') });
    s.tryReserve(req({ taskId: 't-1' }));
    s.release('t-1');
    const out = s.tryReserve(req({ taskId: 't-2' }));
    expect(out.ok && out.kind === 'local' && out.modelId).toBe('qwen-coder-72b');
  });
});
