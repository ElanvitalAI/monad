import { describe, expect, test } from 'bun:test';

import { runScreenContrast } from './screen-contrast-run.js';

const ESC = '\x1b';
const fg = (r: number, g: number, b: number): string => `${ESC}[38;2;${r};${g};${b}m`;

describe('runScreenContrast', () => {
  test('reports below-threshold text and its contrast ratio', () => {
    const result = runScreenContrast({ ansi: `${fg(0, 0, 0)}faint${ESC}[0m`, background: '#000000' });

    expect(result.report.findings).toHaveLength(1);
    expect(result.lines).toContain('below-threshold: "faint" 1.00:1');
    expect(result.lines).toContain('unresolved: 0');
  });

  test('accepts an optional threshold and default background', () => {
    const result = runScreenContrast({ ansi: `${fg(120, 120, 120)}mid${ESC}[0m`, background: 'ffffff', threshold: 3 });

    expect(result.report.threshold).toBe(3);
    expect(result.report.findings).toEqual([]);
    expect(result.lines).toContain('below-threshold: 0 (threshold 3:1)');
  });

  test('always reports unresolved runs without presenting them as clean', () => {
    const result = runScreenContrast({ ansi: `${fg(0, 0, 0)}unknown-ground${ESC}[0m` });

    expect(result.report.unresolved).toBe(1);
    expect(result.lines).toContain('unresolved: 1');
    expect(result.lines).not.toContain('clean');
  });

  test('forwards default foreground and reports decorative runs outside findings', () => {
    const result = runScreenContrast({
      ansi: `${fg(30, 30, 30)}━━━━█${ESC}[0mimplicit`,
      background: '#000000',
      foreground: '#000000',
    });

    expect(result.report.decorative).toBe(1);
    expect(result.report.unresolved).toBe(0);
    expect(result.report.findings.map((finding) => finding.text)).toEqual(['implicit']);
    expect(result.lines).toContain('decorative: 1');
    expect(result.lines.some((line) => line.includes('━━━━█'))).toBeFalse();
  });
});
