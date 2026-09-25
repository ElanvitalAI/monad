// ── T5 (Phase 3 Bundle 1) — cross-shell-query tests ──

import { describe, expect, test } from 'bun:test';
import {
  createCrossShellQuery,
  createInMemoryQueryCache,
  type CrossShellQueryAnswer,
  type CrossShellQueryProvider,
} from '../src/conductor/cross-shell-query';

const RECORDS = [
  { shellId: 'a', summary: 'pytest', tail: 'PASS', exitCode: 0, endedAt: '2026-05-01T10:00:00Z' },
  { shellId: 'b', summary: 'npm build', tail: 'FAILED: Module not found', exitCode: 1, endedAt: '2026-05-01T10:30:00Z' },
];

const fakeAnswer: CrossShellQueryAnswer = {
  answer: 'pytest passed; npm build failed (Module not found)',
  cited: ['a', 'b'],
};

describe('createCrossShellQuery', () => {
  test('happy path → provider invoked + answer returned', async () => {
    let captured: { question: string; recordsCount: number } | null = null;
    const provider: CrossShellQueryProvider = async (input) => {
      captured = { question: input.question, recordsCount: input.records.length };
      return fakeAnswer;
    };
    const q = createCrossShellQuery({ provider });
    const out = await q.ask({ question: 'today summary?', records: RECORDS });
    expect(out).toEqual(fakeAnswer);
    expect(captured!.question).toBe('today summary?');
    expect(captured!.recordsCount).toBe(2);
  });

  test('empty question → null (no provider call)', async () => {
    let calls = 0;
    const q = createCrossShellQuery({
      provider: async () => { calls += 1; return fakeAnswer; },
    });
    expect(await q.ask({ question: '', records: RECORDS })).toBeNull();
    expect(calls).toBe(0);
  });

  test('provider returns null → null', async () => {
    const q = createCrossShellQuery({
      provider: async () => null,
    });
    expect(await q.ask({ question: 'q', records: RECORDS })).toBeNull();
  });

  test('provider exceeds budget → null', async () => {
    const q = createCrossShellQuery({
      provider: () => new Promise((r) => setTimeout(() => r(fakeAnswer), 200)),
      budgetMs: 50,
    });
    expect(await q.ask({ question: 'q', records: RECORDS })).toBeNull();
  });

  test('provider throws → null (graceful)', async () => {
    const q = createCrossShellQuery({
      provider: async () => { throw new Error('llm down'); },
    });
    expect(await q.ask({ question: 'q', records: RECORDS })).toBeNull();
  });

  test('cache hit short-circuits second call', async () => {
    let calls = 0;
    const q = createCrossShellQuery({
      provider: async () => { calls += 1; return fakeAnswer; },
      cache: createInMemoryQueryCache(),
    });
    await q.ask({ question: 'q', records: RECORDS });
    await q.ask({ question: 'q', records: RECORDS });
    expect(calls).toBe(1);
  });

  test('cache miss when records change', async () => {
    let calls = 0;
    const q = createCrossShellQuery({
      provider: async () => { calls += 1; return fakeAnswer; },
      cache: createInMemoryQueryCache(),
    });
    await q.ask({ question: 'q', records: RECORDS });
    await q.ask({ question: 'q', records: [...RECORDS, {
      shellId: 'c', summary: 'extra', tail: '', endedAt: '2026-05-01T11:00:00Z',
    }] });
    expect(calls).toBe(2);
  });

  test('record tail trimmed by budget', async () => {
    const long = 'x'.repeat(5000);
    let receivedTailLen = 0;
    const q = createCrossShellQuery({
      provider: async (input) => {
        receivedTailLen = input.records[0]!.tail.length;
        return fakeAnswer;
      },
      tailMaxChars: 100,
    });
    await q.ask({ question: 'q', records: [{ shellId: 'a', summary: '', tail: long }] });
    expect(receivedTailLen).toBe(100);
  });

  test('records over maxRecords truncated to most recent', async () => {
    let received = 0;
    const q = createCrossShellQuery({
      provider: async (input) => {
        received = input.records.length;
        return fakeAnswer;
      },
      maxRecords: 3,
    });
    await q.ask({
      question: 'q',
      records: Array.from({ length: 10 }, (_, i) => ({
        shellId: `s${i}`, summary: '', tail: '',
      })),
    });
    expect(received).toBe(3);
  });

  test('cacheKey is deterministic', () => {
    const q = createCrossShellQuery({ provider: async () => null });
    const k1 = q.cacheKey({ question: 'q', records: RECORDS });
    const k2 = q.cacheKey({ question: 'q', records: RECORDS.slice().reverse() });
    expect(k1).toBe(k2);
  });
});

describe('createInMemoryQueryCache', () => {
  test('get returns null for unknown key', () => {
    const c = createInMemoryQueryCache();
    expect(c.get('x')).toBeNull();
  });

  test('set + get roundtrip', () => {
    const c = createInMemoryQueryCache();
    c.set('k', fakeAnswer, 60_000);
    expect(c.get('k')).toEqual(fakeAnswer);
  });

  test('expired entry returns null + auto-evicts', async () => {
    const c = createInMemoryQueryCache();
    c.set('k', fakeAnswer, 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(c.get('k')).toBeNull();
    // second get also null (no double-prune crash)
    expect(c.get('k')).toBeNull();
  });
});
