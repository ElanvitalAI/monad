// WT-A-3b — `:agent` context bundler unit tests.
//
// Verifies the prompt composer wraps each piece of terminal context in
// the expected fenced block (so the LLM can identify them) and that the
// user prompt always lands at the bottom (instruction-following).

import { describe, expect, test } from 'bun:test';
import {
  collectAgentContext,
  formatAgentPrompt,
} from '../src/repl/agent-context-bundle';

function fakePt(opts: {
  bufferText: string;
  cwd: string;
  cols: number;
  rows: number;
}): unknown {
  return {
    cols: opts.cols,
    rows: opts.rows,
    opts: { cwd: opts.cwd },
    renderForLLM: () => opts.bufferText,
  };
}

describe('collectAgentContext', () => {
  test('returns empty bundle when sessionId or terminalId is empty', () => {
    const empty1 = collectAgentContext('', 'tid', () => null);
    const empty2 = collectAgentContext('sid', '', () => null);
    expect(empty1.bufferText).toBe('');
    expect(empty1.cols).toBe(0);
    expect(empty2.bufferText).toBe('');
  });

  test('returns empty bundle when resolver returns null', () => {
    const ctx = collectAgentContext('sid', 'tid', () => null);
    expect(ctx.bufferText).toBe('');
    expect(ctx.cwd).toBe('');
    expect(ctx.bufferLines).toBe(0);
  });

  test('extracts buffer + cwd + dimensions from PreviewTerminal', () => {
    const pt = fakePt({
      bufferText: '$ ls\nfile.txt\nREADME.md',
      cwd: '/home/example/proj',
      cols: 80,
      rows: 24,
    });
    const ctx = collectAgentContext('sid', 'tid', () => pt as never);
    expect(ctx.bufferText).toBe('$ ls\nfile.txt\nREADME.md');
    expect(ctx.cwd).toBe('/home/example/proj');
    expect(ctx.cols).toBe(80);
    expect(ctx.rows).toBe(24);
    expect(ctx.bufferLines).toBe(3);
  });

  test('swallows renderForLLM errors and returns empty buffer', () => {
    const pt = {
      cols: 80,
      rows: 24,
      opts: { cwd: '/x' },
      renderForLLM: () => { throw new Error('boom'); },
    };
    const ctx = collectAgentContext('sid', 'tid', () => pt as never);
    expect(ctx.bufferText).toBe('');
    // cwd / dims still resolve so the prompt header isn't blank when
    // only the renderForLLM call faulted.
    expect(ctx.cwd).toBe('/x');
    expect(ctx.cols).toBe(80);
  });
});

describe('formatAgentPrompt', () => {
  test('wraps buffer + header in fenced blocks; prompt at bottom', () => {
    const out = formatAgentPrompt('what is in this dir?', {
      bufferText: '$ ls\nfile.txt',
      cwd: '/home/x',
      cols: 80,
      rows: 24,
      bufferLines: 2,
    });
    expect(out).toContain('<terminal-context>');
    expect(out).toContain('cwd: /home/x');
    expect(out).toContain('size: 80×24 (2 buffer lines)');
    expect(out).toContain('</terminal-context>');
    expect(out).toContain('<terminal-buffer>');
    expect(out).toContain('$ ls\nfile.txt');
    expect(out).toContain('</terminal-buffer>');
    // Prompt must be the trailing line (closer-to-end position).
    expect(out.endsWith('what is in this dir?')).toBe(true);
  });

  test('drops empty fields cleanly', () => {
    const out = formatAgentPrompt('hello', {
      bufferText: '',
      cwd: '',
      cols: 0,
      rows: 0,
      bufferLines: 0,
    });
    expect(out).toBe('hello');
  });

  test('keeps prompt-only output when only buffer is empty but header exists', () => {
    const out = formatAgentPrompt('hi', {
      bufferText: '',
      cwd: '/x',
      cols: 80,
      rows: 24,
      bufferLines: 0,
    });
    // Header block is emitted (cwd + size present), buffer block is
    // skipped (empty bufferText).
    expect(out).toContain('<terminal-context>');
    expect(out).not.toContain('<terminal-buffer>');
    expect(out.endsWith('hi')).toBe(true);
  });
});
