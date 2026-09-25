// M2-4 v2 (Phase 3) — voice-suggest CLI tests.

import { describe, expect, test } from 'bun:test';
import { runVoiceSuggestCommand } from '../../src/cli/voice-suggest.js';
import type { LlmMessage } from '../../src/model-tier/index.js';

describe('M2-4 v2 · runVoiceSuggestCommand · heuristic mode', () => {
  test('classifies medical_dictation by keyword match', async () => {
    const r = await runVoiceSuggestCommand({
      text: 'Doctor visit · prescription notes',
    });
    expect(r.exitCode).toBe(0);
    expect(r.suggestion.preset).toBe('medical_dictation');
    expect(r.suggestion.source).toBe('heuristic');
    expect(r.output.some((l) => l.includes('Medical / legal dictation'))).toBe(true);
    expect(r.output.some((l) => l.includes('(heuristic)'))).toBe(true);
  });

  test('empty text → exit 2 with usage hint', async () => {
    const r = await runVoiceSuggestCommand({ text: '   ' });
    expect(r.exitCode).toBe(2);
    expect(r.output.some((l) => l.startsWith('Usage:'))).toBe(true);
  });
});

describe('M2-4 v2 · runVoiceSuggestCommand · --llm mode', () => {
  test('uses injected runner and tags source = llm', async () => {
    const runner = async (_messages: readonly LlmMessage[]): Promise<string> => {
      return '{"preset":"live_caption","confidence":0.91,"matchedKeywords":["narrate","live"]}';
    };
    const r = await runVoiceSuggestCommand({
      text: 'narrate the live awards broadcast for hearing-impaired viewers',
      useLlm: true,
      runner,
    });
    expect(r.exitCode).toBe(0);
    expect(r.suggestion.preset).toBe('live_caption');
    expect(r.suggestion.source).toBe('llm');
    expect(r.output.some((l) => l.includes('(llm)'))).toBe(true);
    expect(r.output.some((l) => l.includes('Live captioning'))).toBe(true);
  });

  test('--llm without --model or runner → exit 2 with hint', async () => {
    const r = await runVoiceSuggestCommand({
      text: 'doctor visit prep',
      useLlm: true,
    });
    expect(r.exitCode).toBe(2);
    expect(r.output[0]).toContain('--llm requires --model');
  });

  test('runner failure → falls back to heuristic · source = fallback', async () => {
    const runner = async (): Promise<string> => { throw new Error('network down'); };
    const r = await runVoiceSuggestCommand({
      text: 'engineering standup notes Mon AM',
      useLlm: true,
      runner,
    });
    expect(r.exitCode).toBe(0);
    expect(r.suggestion.preset).toBe('meeting');
    expect(r.suggestion.source).toBe('fallback');
    expect(r.output.some((l) => l.includes('(fallback)'))).toBe(true);
  });

  test('respects custom timeoutMs', async () => {
    const slowRunner = (): Promise<string> => new Promise((resolve) => {
      setTimeout(() => resolve('{"preset":"meeting","confidence":0.7,"matchedKeywords":[]}'), 100);
    });
    const r = await runVoiceSuggestCommand({
      text: 'standup minutes for the engineering team',
      useLlm: true,
      runner: slowRunner,
      timeoutMs: 20,
    });
    expect(r.suggestion.source).toBe('fallback');
  });
});
