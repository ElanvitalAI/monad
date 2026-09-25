import { describe, expect, test } from 'bun:test';

import { renderPlanBodyMarkdown } from '../src/display/markdown-light.js';
import { stripAnsi } from '../src/tui.js';

// Convenience: render → strip ANSI → assert structural shape. ANSI
// escapes are stripped by chalk under non-TTY (test) so structural
// invariants are the load-bearing contract.
function plain(src: string): string {
  return stripAnsi(renderPlanBodyMarkdown(src));
}

describe('renderPlanBodyMarkdown', () => {
  test('preserves line count of plain input', () => {
    const src = ['alpha', 'beta', '', 'gamma'].join('\n');
    expect(renderPlanBodyMarkdown(src).split('\n')).toHaveLength(4);
  });

  test('plain text passes through unchanged after ANSI strip', () => {
    const src = ['hello world', 'no markdown here'].join('\n');
    expect(plain(src)).toBe(src);
  });

  test('# heading 1 strips back to original', () => {
    expect(plain('# Title')).toBe('# Title');
  });

  test('### heading 3 supported (depth 1-3)', () => {
    expect(plain('### Subsection')).toBe('### Subsection');
  });

  test('#### heading depth > 3 is byte-stable plain text', () => {
    const src = '#### Deep';
    expect(renderPlanBodyMarkdown(src)).toBe(src);
  });

  test('- bullet list rendered with • marker', () => {
    expect(plain('- first item')).toBe('• first item');
    expect(plain('  - nested item')).toBe('  • nested item');
  });

  test('* bullet list rendered with • marker', () => {
    expect(plain('* alt bullet')).toBe('• alt bullet');
  });

  test('numbered list keeps the marker', () => {
    expect(plain('1. step one')).toBe('1. step one');
    expect(plain('12. step twelve')).toBe('12. step twelve');
  });

  test('> blockquote rendered with │ gutter', () => {
    expect(plain('> note')).toBe('│ note');
  });

  test('inline code strips back to body text', () => {
    expect(plain('use `bun test` to run')).toBe('use bun test to run');
  });

  test('**bold** transforms inline content (strip clean)', () => {
    expect(plain('this is **important** stuff')).toBe('this is important stuff');
  });

  test('*italic* transforms when not adjacent to **', () => {
    expect(plain('an *aside* here')).toBe('an aside here');
  });

  test('_italic_ transforms outside word boundaries', () => {
    expect(plain('a _word_ italic')).toBe('a word italic');
  });

  test('snake_case identifiers are not mistaken for italic', () => {
    const src = 'function snake_case_name() {}';
    expect(plain(src)).toBe(src);
    expect(renderPlanBodyMarkdown(src)).toBe(src);
  });

  test('``` code fence preserves line count + byte-stable plain text', () => {
    const src = ['```ts', 'const x = 1;', 'const y = 2;', '```', 'after'].join('\n');
    const out = renderPlanBodyMarkdown(src).split('\n');
    expect(out).toHaveLength(5);
    expect(plain(src).split('\n')).toEqual([
      '```ts',
      'const x = 1;',
      'const y = 2;',
      '```',
      'after',
    ]);
  });

  test('inside code fence, markdown syntax is not re-rendered', () => {
    const src = ['```', '# not a heading', '- not a bullet', '```'].join('\n');
    const out = renderPlanBodyMarkdown(src).split('\n');
    expect(stripAnsi(out[1]!)).toBe('# not a heading');
    expect(stripAnsi(out[2]!)).toBe('- not a bullet');
  });

  test('inline code shields nested ** from bold transform', () => {
    const src = 'literal `**not bold**` here';
    expect(plain(src)).toBe('literal **not bold** here');
  });

  test('mixed plan body roundtrip is structurally stable', () => {
    const src = [
      '# Refactor plan',
      '',
      '## Steps',
      '',
      '1. Drop the legacy hook',
      '2. Wire the new adapter',
      '',
      '- Validate tests pass',
      '- Update **CHANGELOG**',
      '',
      '> Note: leave `compat-shim.ts` untouched',
    ].join('\n');
    const out = renderPlanBodyMarkdown(src).split('\n');
    expect(out).toHaveLength(11);
    expect(plain(src).split('\n')).toEqual([
      '# Refactor plan',
      '',
      '## Steps',
      '',
      '1. Drop the legacy hook',
      '2. Wire the new adapter',
      '',
      '• Validate tests pass',
      '• Update CHANGELOG',
      '',
      '│ Note: leave compat-shim.ts untouched',
    ]);
  });

  test('empty input renders to empty string', () => {
    expect(renderPlanBodyMarkdown('')).toBe('');
  });

  test('single-line input without markdown is unchanged', () => {
    expect(renderPlanBodyMarkdown('plain line')).toBe('plain line');
  });
});
