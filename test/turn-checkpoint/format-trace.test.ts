// PLAN §4.3 · Phase 1.3 — formatDebugTrace formatter tests.

import { describe, expect, test } from 'bun:test';
import { formatDebugTrace } from '../../src/turn-checkpoint/index.js';
import type { TurnCheckpoint } from '../../src/turn-checkpoint/index.js';
import { mintTurnUri } from '../../src/mss/uri/builder.js';

function makeCheckpoint(overrides: Partial<TurnCheckpoint> = {}): TurnCheckpoint {
  return {
    turnUri: mintTurnUri(),
    toolIndex: 3,
    timestamp: '2026-04-25T13:30:00.000Z',
    decision: { kind: 'edit', preview: 'Edit: file_path=src/llm.ts' },
    messageCount: 12,
    loop: {
      execution: {
        lastCommand: 'bun test',
        lastSummary: 'PASS',
        primarySourceFile: 'src/llm.ts',
        interestingLine: 'expected 4 but got 3',
      },
      verification: {
        lastCommand: 'bun test',
        lastSummary: 'PASS',
        historyLen: 2,
        needsRefresh: false,
      },
      finalization: {
        verificationStillCurrent: true,
        forceFinalAnswer: true,
      },
      signal: {
        primarySourceFile: 'src/llm.ts',
        primaryTestFile: 'test/llm.test.ts',
        interestingLine: 'expected 4 but got 3',
      },
    },
    recentText: 'I will edit src/llm.ts to fix the assertion mismatch.',
    recentMessages: [
      { role: 'user', text: 'fix the failing test' },
      { role: 'assistant', text: 'I will edit src/llm.ts...' },
    ],
    ...overrides,
  };
}

describe('formatDebugTrace — empty', () => {
  test('null checkpoint returns a guidance message', () => {
    const lines = formatDebugTrace(null);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('no checkpoint');
    expect(lines.join('\n')).toContain('/pause');
  });
});

describe('formatDebugTrace — full snapshot', () => {
  test('header includes turn suffix + checkpoint index + decision kind', () => {
    const cp = makeCheckpoint();
    const lines = formatDebugTrace(cp);
    expect(lines[0]).toContain(cp.turnUri.slice(-12));
    expect(lines[0]).toContain('#3');
    expect(lines[0]).toContain('edit');
  });

  test('decision preview is on its own line', () => {
    const lines = formatDebugTrace(makeCheckpoint());
    expect(lines.join('\n')).toContain('Edit: file_path=src/llm.ts');
  });

  test('all four section headers appear', () => {
    const lines = formatDebugTrace(makeCheckpoint());
    const text = lines.join('\n');
    expect(text).toContain('── ExecutionLoopState ──');
    expect(text).toContain('── VerificationLoopState ──');
    expect(text).toContain('── FinalizationPolicySnapshot ──');
    expect(text).toContain('── LoopSignalSnapshot ──');
  });

  test('forceFinalAnswer=true renders the success interpretation', () => {
    const lines = formatDebugTrace(makeCheckpoint());
    expect(lines.join('\n')).toContain('✓ forceFinalAnswer=true');
    expect(lines.join('\n')).toContain('PASS');
  });

  test('needsRefresh=true renders the warning interpretation', () => {
    const cp = makeCheckpoint();
    cp.loop.verification!.needsRefresh = true;
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).toContain('⚠ needsRefresh=true');
  });

  test('verificationStillCurrent=false renders the stale-verify warning', () => {
    const cp = makeCheckpoint();
    cp.loop.finalization!.verificationStillCurrent = false;
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).toContain('⚠ verificationStillCurrent=false');
    expect(lines.join('\n')).toContain('재검증 필요');
  });

  test('signal interpretation joins source/test/hint when all present', () => {
    const lines = formatDebugTrace(makeCheckpoint());
    const text = lines.join('\n');
    expect(text).toContain('source=src/llm.ts');
    expect(text).toContain('test=test/llm.test.ts');
    expect(text).toContain('hint="expected 4 but got 3"');
  });

  test('recent text snippet appears with trim + cap', () => {
    const long = 'a'.repeat(500);
    const lines = formatDebugTrace(makeCheckpoint({ recentText: long }));
    const recentSection = lines.join('\n');
    expect(recentSection).toContain('recent assistant text');
    // Cap at 200 chars + ellipsis when over.
    const recentLine = lines.find((l) => l.startsWith('  ' + 'a'));
    expect(recentLine).toBeDefined();
    expect(recentLine!.length).toBeLessThanOrEqual(2 + 201); // "  " prefix + 200 chars + "…"
    expect(recentLine!.endsWith('…')).toBe(true);
  });

  test('recent messages tail renders one line per message with role', () => {
    const lines = formatDebugTrace(makeCheckpoint());
    const text = lines.join('\n');
    expect(text).toContain('[user]');
    expect(text).toContain('[assistant]');
  });
});

describe('formatDebugTrace — sparse snapshots', () => {
  test('null execution renders the no-state hint', () => {
    const cp = makeCheckpoint();
    cp.loop.execution = undefined;
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).toContain('(no execution snapshot)');
  });

  test('verification with zero history renders the "no verify yet" hint', () => {
    const cp = makeCheckpoint();
    cp.loop.verification = {
      lastCommand: null, lastSummary: null,
      historyLen: 0, needsRefresh: false,
    };
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).toContain('no verify run yet');
  });

  test('execution without lastCommand renders the "no Bash yet" hint', () => {
    const cp = makeCheckpoint();
    cp.loop.execution = {
      lastCommand: null, lastSummary: null,
      primarySourceFile: null, interestingLine: null,
    };
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).toContain('no Bash/RunShell run yet');
  });

  test('signal with all-null fields renders the empty-signal hint', () => {
    const cp = makeCheckpoint();
    cp.loop.signal = {
      primarySourceFile: null, primaryTestFile: null, interestingLine: null,
    };
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).toContain('(empty signal');
  });

  test('checkpoint without recentText omits the text section', () => {
    const cp = makeCheckpoint({ recentText: undefined });
    const lines = formatDebugTrace(cp);
    expect(lines.join('\n')).not.toContain('recent assistant text');
  });

  test('checkpoint without recentMessages omits the messages section', () => {
    const cp = makeCheckpoint();
    delete cp.recentMessages;
    const lines = formatDebugTrace(cp);
    expect(lines.some((l) => /recent \d+ message/.test(l))).toBe(false);
    expect(lines.some((l) => /\[user\]|\[assistant\]/.test(l))).toBe(false);
  });
});
