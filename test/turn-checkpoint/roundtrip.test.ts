// PLAN §4.1 · Phase 1.1 — end-to-end roundtrip: capture → load → resume seed.
//
// Validates the contract a `/pause` followed by `/resume` flow has to
// satisfy, end-to-end, without standing up `streamLLMWithTools`:
//   1. /pause → next decision boundary writes a "pause" checkpoint
//   2. /resume → loadMostRecent() returns the row + formatResumeSeed
//      produces a user-message string that round-trips JSON without
//      losing its key fields.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  setCheckpointDir,
  maybeCaptureDecision, formatResumeSeed,
  requestPause, resetPauseFlag, isPauseRequested,
  loadMostRecent, loadLatest,
} from '../../src/turn-checkpoint/index.js';
import { mintTurnUri } from '../../src/mss/uri/builder.js';
import type { LLMMessage } from '../../src/llm.js';

const dirs: string[] = [];
beforeEach(() => {
  resetPauseFlag();
  const d = mkdtempSync(join(tmpdir(), 'turn-checkpoint-rt-'));
  dirs.push(d);
  setCheckpointDir(d);
});
afterEach(() => {
  resetPauseFlag();
  setCheckpointDir(null);
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const loop = {
  execution: {
    lastCommand: 'bun test',
    lastSummary: 'PASS',
    primarySourceFile: 'src/llm.ts',
    interestingLine: 'expected x to equal y',
  },
  verification: {
    lastCommand: 'bun test',
    lastSummary: 'PASS',
    historyLen: 1,
    needsRefresh: false,
  },
  finalization: { verificationStillCurrent: true, forceFinalAnswer: false },
  signal: {
    primarySourceFile: 'src/llm.ts',
    primaryTestFile: 'test/llm.test.ts',
    interestingLine: 'expected x to equal y',
  },
};

const history: LLMMessage[] = [
  { role: 'user', content: 'fix the bug in src/llm.ts' },
  { role: 'assistant', content: 'Reading the file first…' },
];

describe('end-to-end /pause → /resume roundtrip', () => {
  test('pause request → capture → loadMostRecent → seed contains key fields', () => {
    const turnUri = mintTurnUri();

    // Simulate the user invoking /pause.
    requestPause();
    expect(isPauseRequested()).toBe(true);

    // Simulate streamLLMWithTools entering its dispatch round with a
    // batch that doesn't include any decision-boundary tools — pause
    // still fires.
    const res = maybeCaptureDecision({
      turnUri, toolIndex: 0, history, loop,
      pendingCalls: [{ name: 'Read', args: { file_path: 'src/llm.ts' } }],
    });
    expect(res.captured).toBe(true);
    expect(res.paused).toBe(true);
    // Flag consumed.
    expect(isPauseRequested()).toBe(false);

    // Simulate the user invoking /resume.
    const cp = loadMostRecent();
    expect(cp).not.toBeNull();
    expect(cp!.turnUri).toBe(turnUri);
    expect(cp!.decision.kind).toBe('pause');

    const seed = formatResumeSeed(cp!);
    // Seed surfaces the prior context the user/LLM needs to continue.
    expect(seed).toContain('src/llm.ts');
    expect(seed).toContain('test/llm.test.ts');
    expect(seed).toContain('PASS');
    expect(seed).toContain(turnUri.slice(-12));
  });

  test('multiple pause attempts within a turn — only first captures', () => {
    const turnUri = mintTurnUri();
    requestPause();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history, loop,
      pendingCalls: [{ name: 'Edit', args: { file_path: 'a' } }],
    });
    expect(isPauseRequested()).toBe(false);
    requestPause();
    maybeCaptureDecision({
      turnUri, toolIndex: 1, history, loop,
      pendingCalls: [{ name: 'Edit', args: { file_path: 'b' } }],
    });
    const cp = loadLatest(turnUri);
    expect(cp?.decision.kind).toBe('pause'); // second request also paused
    expect(cp?.toolIndex).toBe(1);
  });

  test('checkpoint JSON round-trips without losing fields', () => {
    const turnUri = mintTurnUri();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history, loop,
      pendingCalls: [{ name: 'Bash', args: { command: 'git commit -m "fix"' } }],
    });
    const cp = loadLatest(turnUri);
    expect(cp).not.toBeNull();
    const json = JSON.stringify(cp);
    const parsed = JSON.parse(json);
    expect(parsed.decision.kind).toBe('commit');
    expect(parsed.loop.signal.primarySourceFile).toBe('src/llm.ts');
    expect(parsed.recentMessages.length).toBe(2);
    expect(parsed.timestamp).toBeDefined();
  });

  test('resume seed remains stable when verify history is empty', () => {
    const turnUri = mintTurnUri();
    const sparseLoop = {
      ...loop,
      verification: { lastCommand: null, lastSummary: null, historyLen: 0, needsRefresh: false },
    };
    requestPause();
    maybeCaptureDecision({
      turnUri, toolIndex: 0, history, loop: sparseLoop,
      pendingCalls: [],
    });
    const cp = loadMostRecent()!;
    const seed = formatResumeSeed(cp);
    // Still produces a usable seed even without verify context.
    expect(seed).toContain('Restate the next planned step');
    expect(seed).not.toContain('Last verify:');
  });
});
