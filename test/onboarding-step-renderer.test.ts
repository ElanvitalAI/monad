import { describe, expect, test } from 'bun:test';
import {
  renderStepBlock,
  renderStepBodyLine,
  renderStepFooter,
  renderStepHeader,
} from '../src/onboarding/step-renderer.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('onboarding/step-renderer', () => {
  test('renderStepHeader(1, 5, "LLM provider") includes counter + title', () => {
    const out = stripAnsi(renderStepHeader(1, 5, 'LLM provider', { profile: 'mono' }));
    expect(out).toContain('Step 1 / 5');
    expect(out).toContain('LLM provider');
  });

  test('renderStepFooter ends with the chosen border bottom-right corner', () => {
    const out = stripAnsi(renderStepFooter({ profile: 'mono', border: 'rounded' }));
    expect(out.endsWith('╯')).toBe(true);
  });

  test('renderStepBodyLine prefixes with the border vertical bar', () => {
    const out = stripAnsi(renderStepBodyLine('hello', { profile: 'mono', border: 'rounded' }));
    expect(out.startsWith('│')).toBe(true);
    expect(out).toContain('hello');
  });

  test('renderStepBlock composes header + body + footer in 3+N lines', () => {
    const out = stripAnsi(
      renderStepBlock(
        2,
        5,
        'Skill directories',
        ['line A', 'line B', 'line C'],
        { profile: 'mono' },
      ),
    );
    const lines = out.split('\n');
    expect(lines.length).toBe(5); // 1 header + 3 body + 1 footer
    expect(lines[0]!).toContain('Step 2 / 5');
    expect(lines[1]!).toContain('line A');
    expect(lines[lines.length - 1]!).toMatch(/[╯╰]/);
  });

  test('truecolor profile emits SGR for accent + muted', () => {
    const out = renderStepHeader(1, 5, 'X', { profile: 'truecolor' });
    expect(out).toContain('38;2;');
  });

  test('mono profile suppresses SGR', () => {
    const out = renderStepHeader(1, 5, 'X', { profile: 'mono' });
    expect(out).not.toContain('\x1b[');
  });

  test('width override expands the rule run', () => {
    const narrow = stripAnsi(renderStepHeader(1, 5, 'X', { profile: 'mono', width: 30 }));
    const wide = stripAnsi(renderStepHeader(1, 5, 'X', { profile: 'mono', width: 80 }));
    expect(wide.length).toBeGreaterThan(narrow.length);
  });
});
