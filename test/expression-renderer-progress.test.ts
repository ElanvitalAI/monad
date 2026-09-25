import { describe, expect, test } from 'bun:test';
import { renderProgress } from '../src/expression/renderer/index.js';
import type { ProgressSpec } from '../src/expression/spec/types.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('expression/renderer/progress', () => {
  test('zero progress emits all-empty bar', () => {
    const spec: ProgressSpec = { kind: 'progress', value: 0, width: 10 };
    const out = renderProgress(spec, 'truecolor');
    expect(stripAnsi(out)).toBe('··········');
  });

  test('full progress emits all-fill bar', () => {
    const spec: ProgressSpec = { kind: 'progress', value: 1, width: 10 };
    const out = renderProgress(spec, 'truecolor');
    expect(stripAnsi(out)).toBe('██████████');
  });

  test('half progress splits 50/50', () => {
    const spec: ProgressSpec = { kind: 'progress', value: 0.5, width: 10 };
    const out = renderProgress(spec, 'truecolor');
    const stripped = stripAnsi(out);
    expect(stripped.split('█').length - 1).toBe(5);
    expect(stripped.split('·').length - 1).toBe(5);
  });

  test('out-of-range value is clamped', () => {
    expect(stripAnsi(renderProgress({ kind: 'progress', value: 2, width: 4 }, 'truecolor'))).toBe('████');
    expect(stripAnsi(renderProgress({ kind: 'progress', value: -1, width: 4 }, 'truecolor'))).toBe('····');
    expect(stripAnsi(renderProgress({ kind: 'progress', value: NaN, width: 4 }, 'truecolor'))).toBe('····');
  });

  test('label appears after the bar', () => {
    const out = renderProgress(
      { kind: 'progress', value: 0.4, width: 10, label: '40%' },
      'truecolor',
    );
    const stripped = stripAnsi(out);
    expect(stripped.endsWith(' 40%')).toBe(true);
  });

  test('dotted style uses ascii-safe glyphs', () => {
    const out = renderProgress(
      { kind: 'progress', value: 0.5, width: 4, bar: 'dotted' },
      'truecolor',
    );
    const stripped = stripAnsi(out);
    expect(stripped).toBe('══──');
  });

  test('gradient style emits per-cell SGR (truecolor)', () => {
    const out = renderProgress(
      { kind: 'progress', value: 1, width: 4, bar: 'gradient' },
      'truecolor',
    );
    // Each filled cell gets its own \x1b[38;2;... — count occurrences.
    const matches = out.match(/\x1b\[38;2;\d+;\d+;\d+m/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  test('mono profile drops SGR but keeps glyphs', () => {
    const out = renderProgress(
      { kind: 'progress', value: 0.3, width: 10, label: '30%' },
      'mono',
    );
    expect(out).toBe('███······· 30%');
  });

  test('ansi256 profile emits 256-color SGR', () => {
    const out = renderProgress(
      { kind: 'progress', value: 1, width: 4 },
      'ansi256',
    );
    expect(out).toContain('38;5;');
  });
});
