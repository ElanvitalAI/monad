// R6 v2 — Hansei polish callable contract.
//
// Cross-ref:
//   src/notes/daily-reflection-polish.ts
//   src/notes/polish-callable.ts (sibling)

import { describe, expect, test } from 'bun:test';

import {
  createDailyReflectionPolishCallable,
  isDailyReflectionPolishAvailable,
} from '../src/notes/daily-reflection-polish.js';
import type { DailyReflectionSnapshot } from '../src/notes/daily-reflection.js';

const SAMPLE_SNAPSHOT: DailyReflectionSnapshot = {
  date: '2026-05-09',
  notesSaved: 3,
  ocrRuns: 5,
  sessionsToday: 2,
  topSessions: [
    { id: 'sess-a', msgCount: 12, lastTurnAt: '2026-05-09T14:00:00Z', lastMsgPreview: 'OCR pipeline 검토' },
    { id: 'sess-b', msgCount: 4, lastTurnAt: '2026-05-09T11:30:00Z' },
  ],
  generatedAt: '2026-05-09T22:00:00Z',
};

const VOID_PUSH = (): void => { /* noop */ };

describe('isDailyReflectionPolishAvailable', () => {
  test('returns false when provider.available() returns false', () => {
    const ok = isDailyReflectionPolishAvailable({
      resolveProvider: () => ({ name: 'anthropic', defaultModel: 'claude', available: () => false }),
    });
    expect(ok).toBe(false);
  });

  test('returns true when provider.available() returns true', () => {
    const ok = isDailyReflectionPolishAvailable({
      resolveProvider: () => ({ name: 'anthropic', defaultModel: 'claude', available: () => true }),
    });
    expect(ok).toBe(true);
  });

  test('returns false when resolveProvider throws', () => {
    const ok = isDailyReflectionPolishAvailable({
      resolveProvider: () => { throw new Error('not configured'); },
    });
    expect(ok).toBe(false);
  });
});

describe('createDailyReflectionPolishCallable', () => {
  test('throws when no provider available', async () => {
    const polish = createDailyReflectionPolishCallable({
      resolveProvider: () => ({ name: 'anthropic', defaultModel: 'claude', available: () => false }),
      llm: async () => 'should not be called',
    });
    await expect(polish({ snapshot: SAMPLE_SNAPSHOT })).rejects.toThrow(/unavailable/);
  });

  test('throws when LLM returns empty string', async () => {
    const polish = createDailyReflectionPolishCallable({
      resolveProvider: () => ({ name: 'anthropic', defaultModel: 'claude', available: () => true }),
      llm: async () => '   \n   ',
    });
    await expect(polish({ snapshot: SAMPLE_SNAPSHOT })).rejects.toThrow(/empty/);
  });

  test('returns trimmed LLM output on success', async () => {
    const polish = createDailyReflectionPolishCallable({
      resolveProvider: () => ({ name: 'anthropic', defaultModel: 'claude', available: () => true }),
      llm: async () => '  \n오늘은 노트 3개 · OCR 5회. 내일은 코드 리뷰부터.\n  ',
    });
    const text = await polish({ snapshot: SAMPLE_SNAPSHOT });
    expect(text).toBe('오늘은 노트 3개 · OCR 5회. 내일은 코드 리뷰부터.');
    void VOID_PUSH; // suppress unused
  });

  test('LLM receives the snapshot context as user text', async () => {
    let capturedMessages: unknown = null;
    const polish = createDailyReflectionPolishCallable({
      resolveProvider: () => ({ name: 'anthropic', defaultModel: 'claude', available: () => true }),
      llm: async (messages) => {
        capturedMessages = messages;
        return '요약 결과';
      },
    });
    await polish({ snapshot: SAMPLE_SNAPSHOT });
    const msgs = capturedMessages as Array<{ role: string; content: string }>;
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toContain('2026-05-09');
    expect(msgs[0]!.content).toContain('OCR 실행: 5');
    expect(msgs[0]!.content).toContain('OCR pipeline 검토');
  });
});
