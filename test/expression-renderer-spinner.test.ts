import { describe, expect, test } from 'bun:test';
import { frameCount, renderSpinner } from '../src/expression/renderer/index.js';
import type { SpinnerSpec } from '../src/expression/spec/types.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('expression/renderer/spinner', () => {
  test('default style is `dots` (10 frames)', () => {
    expect(frameCount(undefined)).toBe(10);
    expect(frameCount('dots')).toBe(10);
  });

  test('frame index wraps modulo frame count', () => {
    const spec: SpinnerSpec = { kind: 'spinner', style: 'line' };
    const f0 = stripAnsi(renderSpinner(spec, 'truecolor', { frame: 0 }));
    const f4 = stripAnsi(renderSpinner(spec, 'truecolor', { frame: 4 }));
    expect(f0).toBe(f4); // line has 4 frames, so 0 ≡ 4 mod 4
  });

  test('negative frame indices are absolutized', () => {
    const spec: SpinnerSpec = { kind: 'spinner', style: 'line' };
    const fNeg = stripAnsi(renderSpinner(spec, 'truecolor', { frame: -1 }));
    const fPos = stripAnsi(renderSpinner(spec, 'truecolor', { frame: 1 }));
    expect(fNeg).toBe(fPos);
  });

  test('label is appended after a space', () => {
    const out = stripAnsi(
      renderSpinner({ kind: 'spinner', label: 'thinking' }, 'truecolor', { frame: 0 }),
    );
    expect(out.endsWith(' thinking')).toBe(true);
  });

  test('5 styles all return non-empty output', () => {
    for (const style of ['dots', 'line', 'arc', 'pulse', 'bounce'] as const) {
      const out = stripAnsi(
        renderSpinner({ kind: 'spinner', style }, 'truecolor', { frame: 0 }),
      );
      expect(out.length).toBeGreaterThan(0);
    }
  });

  test('frameCount matches the number of unique frames', () => {
    expect(frameCount('dots')).toBe(10);
    expect(frameCount('line')).toBe(4);
    expect(frameCount('arc')).toBe(6);
    expect(frameCount('pulse')).toBe(8);
    expect(frameCount('bounce')).toBe(8);
  });

  test('mono profile suppresses color but keeps glyph + label', () => {
    const out = renderSpinner(
      { kind: 'spinner', style: 'line', label: 'hi' },
      'mono',
      { frame: 0 },
    );
    expect(out).toBe('- hi');
  });

  test('truecolor profile emits SGR around the glyph', () => {
    const out = renderSpinner(
      { kind: 'spinner', style: 'line' },
      'truecolor',
      { frame: 0 },
    );
    expect(out).toContain('38;2;');
  });

  test('purity — same input produces same output across calls', () => {
    const spec: SpinnerSpec = { kind: 'spinner', style: 'pulse' };
    const a = renderSpinner(spec, 'truecolor', { frame: 3 });
    const b = renderSpinner(spec, 'truecolor', { frame: 3 });
    expect(a).toBe(b);
  });
});
