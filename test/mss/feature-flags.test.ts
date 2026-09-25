import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { __resetFlagsForTests, getFlags } from '../../src/mss/feature-flags.js';

describe('mss feature-flags', () => {
  const snapshot: Record<string, string | undefined> = {};
  const keys = [
    'MSS_ENABLED',
    'MSS_PHASE',
    'MSS_LLM_JUDGE',
    'MSS_SLEEP_LLM_SUMMARY',
    'MSS_LLM_JUDGE_MODEL',
    'MSS_SLEEP_LLM_SUMMARY_MODEL',
    'MSS_STDERR_SINK',
    'MSS_STDERR_LEVEL',
  ];

  beforeEach(() => {
    for (const k of keys) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
    __resetFlagsForTests();
  });

  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
    __resetFlagsForTests();
  });

  test('defaults honour DD-MSS-33/36/38', () => {
    const f = getFlags();
    expect(f.enabled).toBe(true);
    expect(f.phase).toBe('mvs');
    expect(f.llmJudge).toBe(false);
    expect(f.sleepLlmSummary).toBe(false);
    expect(f.llmJudgeModel).toBe('anthropic:claude-haiku');
    expect(f.sleepLlmSummaryModel).toBe('anthropic:claude-haiku');
    expect(f.stderrSink).toBe(false);
    expect(f.stderrSinkLevel).toBeUndefined();
  });

  test('MSS_STDERR_SINK opt-in + MSS_STDERR_LEVEL filter parse', () => {
    process.env.MSS_STDERR_SINK = '1';
    process.env.MSS_STDERR_LEVEL = 'warn';
    __resetFlagsForTests();
    const f = getFlags();
    expect(f.stderrSink).toBe(true);
    expect(f.stderrSinkLevel).toBe('warn');
  });

  test('invalid MSS_STDERR_LEVEL → undefined (no filter)', () => {
    process.env.MSS_STDERR_SINK = 'on';
    process.env.MSS_STDERR_LEVEL = 'verbose';
    __resetFlagsForTests();
    const f = getFlags();
    expect(f.stderrSink).toBe(true);
    expect(f.stderrSinkLevel).toBeUndefined();
  });

  test('truthy env overrides parse', () => {
    process.env.MSS_ENABLED = 'false';
    process.env.MSS_LLM_JUDGE = '1';
    process.env.MSS_SLEEP_LLM_SUMMARY = 'on';
    process.env.MSS_PHASE = 'm2';
    process.env.MSS_LLM_JUDGE_MODEL = 'ollama:qwen2.5:3b';
    __resetFlagsForTests();
    const f = getFlags();
    expect(f.enabled).toBe(false);
    expect(f.llmJudge).toBe(true);
    expect(f.sleepLlmSummary).toBe(true);
    expect(f.phase).toBe('m2');
    expect(f.llmJudgeModel).toBe('ollama:qwen2.5:3b');
  });

  test('invalid env → fallback', () => {
    process.env.MSS_ENABLED = 'maybe';
    process.env.MSS_PHASE = 'm99';
    __resetFlagsForTests();
    const f = getFlags();
    expect(f.enabled).toBe(true);       // fallback true
    expect(f.phase).toBe('mvs');        // fallback mvs
  });

  test('cached frozen singleton — multiple calls return same object', () => {
    const a = getFlags();
    const b = getFlags();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });
});
