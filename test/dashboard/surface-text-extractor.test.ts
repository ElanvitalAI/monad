// ── T2 (Phase 1) — surface-text-extractor tests ──

import { describe, expect, test } from 'bun:test';
import {
  extractWordAt,
  extractRange,
} from '../../src/dashboard/terminal/surface-text-extractor';

describe('extractWordAt', () => {
  test('extracts simple identifier at column', () => {
    const r = extractWordAt(['  hello world  '], 0, 4);
    expect(r).not.toBeNull();
    expect(r!.text).toBe('hello');
    expect(r!.startCol).toBe(2);
    expect(r!.endCol).toBe(6);
  });

  test('respects path-like word characters', () => {
    const r = extractWordAt(['cat src/conductor/index.ts'], 0, 14);
    expect(r!.text).toBe('src/conductor/index.ts');
  });

  test('extracts URL with colon and slash', () => {
    const r = extractWordAt(['fetch https://example.com/foo'], 0, 18);
    expect(r!.text).toBe('https://example.com/foo');
  });

  test('extracts word with hyphen and underscore', () => {
    const r = extractWordAt(['  my_variable-name  '], 0, 5);
    expect(r!.text).toBe('my_variable-name');
  });

  test('returns null on whitespace position', () => {
    expect(extractWordAt(['  hello world  '], 0, 7)).toBeNull();
  });

  test('returns null on non-word punctuation', () => {
    expect(extractWordAt(['(parens)'], 0, 0)).toBeNull();
  });

  test('returns null when row out of bounds', () => {
    expect(extractWordAt(['line0'], 5, 0)).toBeNull();
  });

  test('returns null when col past line', () => {
    expect(extractWordAt(['short'], 0, 100)).toBeNull();
  });

  test('handles single-char word', () => {
    const r = extractWordAt([' x '], 0, 1);
    expect(r!.text).toBe('x');
    expect(r!.startCol).toBe(1);
    expect(r!.endCol).toBe(1);
  });

  test('extracts at line start', () => {
    const r = extractWordAt(['leading'], 0, 0);
    expect(r!.text).toBe('leading');
  });

  test('extracts at line end', () => {
    const r = extractWordAt(['trailing'], 0, 7);
    expect(r!.text).toBe('trailing');
  });
});

describe('extractRange', () => {
  test('single-line range', () => {
    const r = extractRange(['  hello world  '], {
      startRow: 0, startCol: 2,
      endRow: 0, endCol: 6,
    });
    expect(r!.text).toBe('hello');
    expect(r!.lineCount).toBe(1);
  });

  test('multi-line range joins with newlines', () => {
    const lines = ['first line', 'middle line', 'last line'];
    const r = extractRange(lines, {
      startRow: 0, startCol: 6,
      endRow: 2, endCol: 3,
    });
    expect(r!.lineCount).toBe(3);
    expect(r!.text).toBe('line\nmiddle line\nlast');
  });

  test('reversed range is normalized', () => {
    const lines = ['ab', 'cd'];
    const r = extractRange(lines, {
      startRow: 1, startCol: 1,
      endRow: 0, endCol: 0,
    });
    // Should be normalized to (0,0) → (1,1) = "ab\ncd"
    expect(r!.text).toBe('ab\ncd');
    expect(r!.normalized.startRow).toBe(0);
    expect(r!.normalized.endRow).toBe(1);
  });

  test('clamps to buffer bounds', () => {
    const r = extractRange(['only'], {
      startRow: 0, startCol: 1,
      endRow: 5, endCol: 100,
    });
    expect(r!.text).toBe('nly');
    expect(r!.lineCount).toBe(1);
  });

  test('returns null when entirely out of bounds', () => {
    expect(extractRange(['x'], {
      startRow: 5, startCol: 0,
      endRow: 6, endCol: 0,
    })).toBeNull();
  });

  test('empty buffer returns null', () => {
    expect(extractRange([], { startRow: 0, startCol: 0, endRow: 0, endCol: 0 })).toBeNull();
  });
});
