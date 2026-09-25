// PLAN §4.1 · Phase 1.1 — resume seed formatter tests.

import { describe, expect, test } from 'bun:test';
import { formatResumeSeed } from '../../src/turn-checkpoint/index.js';
import type { TurnCheckpoint } from '../../src/turn-checkpoint/index.js';
import { mintTurnUri } from '../../src/mss/uri/builder.js';

function makeCheckpoint(overrides: Partial<TurnCheckpoint> = {}): TurnCheckpoint {
  return {
    turnUri: mintTurnUri(),
    toolIndex: 2,
    timestamp: '2026-04-25T12:00:00.000Z',
    decision: { kind: 'edit', preview: 'Edit: file_path=src/foo.ts' },
    messageCount: 8,
    loop: {
      execution: {
        lastCommand: 'bun test test/foo.test.ts',
        lastSummary: 'FAIL · 1 fail / 12 pass',
        primarySourceFile: 'src/foo.ts',
        interestingLine: 'expected true to be false',
      },
      verification: {
        lastCommand: 'bun test',
        lastSummary: 'PASS',
        historyLen: 3,
        needsRefresh: false,
      },
      finalization: { verificationStillCurrent: true, forceFinalAnswer: false },
      signal: {
        primarySourceFile: 'src/foo.ts',
        primaryTestFile: 'test/foo.test.ts',
        interestingLine: 'expected true to be false',
      },
    },
    recentText: 'I will edit src/foo.ts to fix the failing assertion.',
    recentMessages: [
      { role: 'user', text: 'fix the failing test' },
      { role: 'assistant', text: 'I will edit src/foo.ts...' },
    ],
    ...overrides,
  };
}

describe('formatResumeSeed', () => {
  test('includes turn suffix + checkpoint index + decision kind', () => {
    const cp = makeCheckpoint();
    const seed = formatResumeSeed(cp);
    expect(seed).toContain('checkpoint #2');
    expect(seed).toContain('edit');
    expect(seed).toContain(cp.turnUri.slice(-12));
  });

  test('includes primary source + test files when available', () => {
    const seed = formatResumeSeed(makeCheckpoint());
    expect(seed).toContain('src/foo.ts');
    expect(seed).toContain('test/foo.test.ts');
  });

  test('includes last verify command + summary', () => {
    const seed = formatResumeSeed(makeCheckpoint());
    expect(seed).toContain('bun test');
    expect(seed).toContain('PASS');
  });

  test('includes recent assistant text snippet', () => {
    const seed = formatResumeSeed(makeCheckpoint());
    expect(seed).toContain('I will edit src/foo.ts');
  });

  test('omits source/test/verify lines when fields are null', () => {
    const seed = formatResumeSeed(makeCheckpoint({
      loop: {
        execution: {
          lastCommand: null, lastSummary: null,
          primarySourceFile: null, interestingLine: null,
        },
        verification: {
          lastCommand: null, lastSummary: null,
          historyLen: 0, needsRefresh: false,
        },
        finalization: { verificationStillCurrent: true, forceFinalAnswer: false },
        signal: {
          primarySourceFile: null, primaryTestFile: null, interestingLine: null,
        },
      },
      recentText: undefined,
    }));
    expect(seed).not.toContain('Primary source:');
    expect(seed).not.toContain('Primary test:');
    expect(seed).not.toContain('Last verify:');
    expect(seed).not.toContain('Recent assistant text:');
    // Always present:
    expect(seed).toContain('Restate the next planned step');
  });

  test('always ends with the restate-next-step instruction', () => {
    const seed = formatResumeSeed(makeCheckpoint());
    expect(seed.endsWith('Restate the next planned step in one line, then proceed.')).toBe(true);
  });

  test('caps recent text at 200 chars', () => {
    const long = 'a'.repeat(500);
    const seed = formatResumeSeed(makeCheckpoint({ recentText: long }));
    const recentLine = seed.split('\n').find((l) => l.startsWith('Recent assistant text:'));
    expect(recentLine).toBeDefined();
    // "Recent assistant text: " (23 chars) + 200 chars max
    expect(recentLine!.length).toBeLessThanOrEqual(23 + 200);
  });
});
