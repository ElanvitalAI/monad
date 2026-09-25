// Image-pipeline followup #4 (2026-05-05) — daemon webterm context
// composer.
//
// Verifies the system-prompt block prepended for kind='webterm':
//   - sessionId line is always present
//   - Active terminals enumerated (or "(none)" placeholder)
//   - Auto-injection note tells the LLM to omit sessionId
//
// Stubs the registry walker so the test is hermetic — no preview-tap
// registry side-effects.

import { describe, expect, test } from 'bun:test';

import {
  composeWebtermSystemContext,
  appendWebtermContext,
} from '../src/boot/daemon-tools/webterm-context.js';
import type { DaemonToolSurface } from '../src/boot/daemon-tools/types.js';

const NO_TERMINALS = (): never[] => [];

const TWO_TERMINALS = (): { terminalId: string; pid: number; cols: number; rows: number; isAlive: boolean }[] => [
  { terminalId: 'preview-1', pid: 100, cols: 120, rows: 32, isAlive: true },
  { terminalId: 'preview-2', pid: 200, cols: 80, rows: 24, isAlive: false },
];

function fakeSurface(kind: DaemonToolSurface['kind']): DaemonToolSurface {
  return {
    kind,
    specs: [],
    async dispatch(): Promise<unknown> { throw new Error('not used'); },
  };
}

describe('composeWebtermSystemContext', () => {
  test("returns null when toolSurface is undefined", () => {
    expect(composeWebtermSystemContext('s', undefined, NO_TERMINALS)).toBeNull();
  });

  test("returns null for kind='none'", () => {
    expect(composeWebtermSystemContext('s', fakeSurface('none'), NO_TERMINALS)).toBeNull();
  });

  test("returns null for kind='readonly' (sessionId not used by Read/Grep/WebSearch)", () => {
    expect(composeWebtermSystemContext('s', fakeSurface('readonly'), NO_TERMINALS)).toBeNull();
  });

  test("returns null for empty sessionId", () => {
    expect(composeWebtermSystemContext('', fakeSurface('webterm'), NO_TERMINALS)).toBeNull();
  });

  test("kind='webterm' + no terminals → sessionId line + file-tool fallback guidance (no 'ask user to open one')", () => {
    const block = composeWebtermSystemContext('sess-abc', fakeSurface('webterm'), NO_TERMINALS);
    expect(block).not.toBeNull();
    expect(block).toContain('Current ACP sessionId: sess-abc');
    expect(block).toContain('Active web terminals: (none yet)');
    // 2026-05-13 chat-friction-free — empty-terminals fallback teaches
    // the LLM to use Read / Grep / Edit instead of asking the user to
    // open a PTY. Old phrase "ask the user to open one" is gone.
    expect(block).toContain('No PTY session is required for filesystem queries');
    expect(block).toContain('Read / Grep / Edit');
    expect(block).not.toContain('ask the user to open');
    // WebTerminal* sessionId reminder is skipped on the empty path —
    // there is no terminalId to thread anyway.
    expect(block).not.toContain('omit it from args');
  });

  test("kind='webterm' + 0 terminals → REPL/vim escalation hint still present", () => {
    const block = composeWebtermSystemContext('sess-abc', fakeSurface('webterm'), NO_TERMINALS);
    expect(block).toContain('interactive workflows');
    expect(block).toMatch(/REPL|vim|watchers/);
  });

  test("kind='webterm' + 2 terminals → enumerates id + dims + alive flag", () => {
    const block = composeWebtermSystemContext('sess-xyz', fakeSurface('webterm'), TWO_TERMINALS);
    expect(block).not.toBeNull();
    expect(block).toContain('Current ACP sessionId: sess-xyz');
    expect(block).toContain('preview-1 (120×32, alive)');
    expect(block).toContain('preview-2 (80×24, dead)');
    expect(block).toContain('auto-resolve sessionId');
  });
});

describe('appendWebtermContext', () => {
  test('returns base prompt unchanged when context is null', () => {
    expect(appendWebtermContext('hello', 's', undefined, NO_TERMINALS)).toBe('hello');
    expect(appendWebtermContext('hello', 's', fakeSurface('none'), NO_TERMINALS)).toBe('hello');
    expect(appendWebtermContext(undefined, 's', fakeSurface('none'), NO_TERMINALS)).toBeUndefined();
  });

  test('appends with blank-line separator when base prompt non-empty', () => {
    const out = appendWebtermContext('System rules.', 'sess-1', fakeSurface('webterm'), NO_TERMINALS);
    expect(out).not.toBeUndefined();
    expect(out!.startsWith('System rules.\n\n')).toBe(true);
    expect(out).toContain('Current ACP sessionId: sess-1');
  });

  test('returns context block alone when base prompt is empty / whitespace', () => {
    const out1 = appendWebtermContext(undefined, 'sess-2', fakeSurface('webterm'), NO_TERMINALS);
    const out2 = appendWebtermContext('   \n  ', 'sess-2', fakeSurface('webterm'), NO_TERMINALS);
    expect(out1).toBe(out2);
    expect(out1).toContain('Current ACP sessionId: sess-2');
    expect(out1!.startsWith('Current ACP sessionId:')).toBe(true);
  });
});
