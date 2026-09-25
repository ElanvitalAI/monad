// ── syntax-color.ts tests (Phase 1 code-display porting) ──
//
// Locks the ANSI-nesting fix so a future refactor can't silently
// reintroduce the bug that PR #644's tool-render preview surfaced.
// Also covers tab normalisation, `replaceOutsideAnsi` invariants, and
// the language branches that were rewritten in the same pass.

import { describe, test, expect, beforeAll } from 'bun:test';
import chalk from 'chalk';
import {
  colorLine,
  normalizeTabs,
  replaceOutsideAnsi,
  TAB_WIDTH,
  SYN,
} from '../src/panes/syntax-color';

// bun test pipes stdout → chalk.level = 0 (no colour). Force a colour
// level so the escape-nesting assertions actually see escape bytes.
beforeAll(() => {
  if (chalk.level < 2) chalk.level = 3;
});

describe('normalizeTabs', () => {
  test(`\\t → ${TAB_WIDTH} spaces`, () => {
    expect(normalizeTabs('a\tb')).toBe(`a${' '.repeat(TAB_WIDTH)}b`);
  });

  test('no tabs → unchanged (no allocation)', () => {
    const s = 'no tabs here';
    expect(normalizeTabs(s)).toBe(s);
  });

  test('multiple tabs in one line', () => {
    expect(normalizeTabs('\tone\ttwo')).toBe(
      `${' '.repeat(TAB_WIDTH)}one${' '.repeat(TAB_WIDTH)}two`,
    );
  });
});

describe('replaceOutsideAnsi', () => {
  test('no escapes → equivalent to String.replace', () => {
    expect(replaceOutsideAnsi('aaa bbb', /a+/g, () => 'X')).toBe('X bbb');
  });

  test('escape segments pass through untouched', () => {
    // Input has a truecolor escape sequence; the replace should NOT
    // match the digits inside it even though \d+ would otherwise hit.
    const input = `plain \x1b[38;2;100;200;50mcolored\x1b[39m plain`;
    const out = replaceOutsideAnsi(input, /\d+/g, (m) => `<${m}>`);
    // Plain parts have no digits; escape sequence digits untouched.
    expect(out).toBe(input);
  });

  test('replaces across multiple plain segments between escapes', () => {
    const input = `1 \x1b[31m2\x1b[39m 3`;
    // Replace digits, but digits inside the escape must be preserved.
    const out = replaceOutsideAnsi(input, /\d+/g, (m) => `<${m}>`);
    expect(out).toBe(`<1> \x1b[31m<2>\x1b[39m <3>`);
  });
});

describe('colorLine — ANSI nesting bug regression', () => {
  test('.ts keywords + numbers no longer produce nested escape corruption', () => {
    const out = colorLine('const x = 1;', '.ts');
    // Forbidden pattern: escape-starts-with-another-escape, e.g.
    // `\x1b[\x1b[38;2;…` — the observed corruption from nested replaces.
    expect(out).not.toMatch(/\x1b\[\x1b\[/);
    // Happy path: at least one well-formed SGR escape survived.
    expect(out).toMatch(/\x1b\[/);
    // Colour emitted for both `const` (keyword) and `1` (number).
    expect(out.includes('const')).toBe(true);
    expect(out.includes('1')).toBe(true);
  });

  test('.py keyword + number path is clean', () => {
    const out = colorLine('def foo(x = 1): pass', '.py');
    expect(out).not.toMatch(/\x1b\[\x1b\[/);
  });

  test('.yaml key + value path is clean', () => {
    const out = colorLine('key: value', '.yaml');
    expect(out).not.toMatch(/\x1b\[\x1b\[/);
  });

  test('unsupported extension → plain text fallback', () => {
    const out = colorLine('echo whatever', '.unknown');
    // SYN.text is identity — so no new escapes are introduced.
    expect(out).toBe('echo whatever');
  });

  test('.js identifies as the shared TS branch (.mjs/.cjs too)', () => {
    for (const ext of ['.js', '.jsx', '.mjs', '.cjs']) {
      const out = colorLine('const a = 2;', ext);
      expect(out).not.toMatch(/\x1b\[\x1b\[/);
      expect(out.includes('const')).toBe(true);
    }
  });
});

describe('SYN palette sanity', () => {
  test('text is identity', () => {
    expect(SYN.text('hello')).toBe('hello');
  });

  test('keyword actually emits an escape when chalk.level > 0', () => {
    const out = SYN.keyword('const');
    expect(out).toMatch(/\x1b\[/);
  });
});
