// PLAN §4.5 · Arc 2.1 — sub-agent seed extractor + formatter tests.

import { describe, expect, test } from 'bun:test';
import {
  extractSubAgentSignal,
  formatSubAgentSeed,
  enhanceAgentResultWithSeed,
} from '../../src/agent/seed.js';

describe('extractSubAgentSignal — happy path', () => {
  test('finds the first src/ path', () => {
    const text = 'Looking at src/llm.ts:1234 we see the issue.';
    const sig = extractSubAgentSignal(text);
    expect(sig?.primarySourceFile).toBe('src/llm.ts');
  });

  test('finds the first test/ path', () => {
    const text = 'Reproduced the failure in test/foo.test.ts.';
    const sig = extractSubAgentSignal(text);
    expect(sig?.primaryTestFile).toBe('test/foo.test.ts');
  });

  test('finds tests/ and __tests__/ variants', () => {
    expect(extractSubAgentSignal('see tests/bar.spec.ts')?.primaryTestFile).toBe('tests/bar.spec.ts');
    expect(extractSubAgentSignal('see __tests__/baz.test.tsx')?.primaryTestFile).toBe('__tests__/baz.test.tsx');
  });

  test('captures up to 3 stack lines', () => {
    const text = [
      'Some prose here.',
      'expected 4 but got 3',
      '  at fooFn (src/foo.ts:12:5)',
      'Error: oh no',
      '  at barFn (src/bar.ts:7:1)', // 4th — should be dropped
    ].join('\n');
    const sig = extractSubAgentSignal(text)!;
    expect(sig.stackPreview.length).toBe(3);
    expect(sig.stackPreview[0]).toContain('expected 4');
    expect(sig.stackPreview[1]).toContain('at fooFn');
    expect(sig.stackPreview[2]).toContain('Error: oh no');
  });

  test('caps each stack line to 120 chars + ellipsis', () => {
    const longLine = 'expected ' + 'x'.repeat(200);
    const sig = extractSubAgentSignal(longLine)!;
    expect(sig.stackPreview[0]?.length).toBeLessThanOrEqual(120);
    expect(sig.stackPreview[0]?.endsWith('…')).toBe(true);
  });

  test('interestingLine prefers an assertion-style line over the call site', () => {
    const text = [
      '  at fooFn (src/foo.ts:12:5)',
      'expected 4 but got 3',
      'Error: kaboom',
    ].join('\n');
    const sig = extractSubAgentSignal(text)!;
    expect(sig.interestingLine).toContain('expected 4 but got 3');
  });

  test('interestingLine falls back to first stack line when no assertion present', () => {
    const sig = extractSubAgentSignal('  at fooFn (src/foo.ts:12:5)')!;
    expect(sig.interestingLine).toContain('at fooFn');
  });
});

describe('extractSubAgentSignal — pass-through', () => {
  test('returns null for empty text', () => {
    expect(extractSubAgentSignal('')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(extractSubAgentSignal(undefined as unknown as string)).toBeNull();
    expect(extractSubAgentSignal(null as unknown as string)).toBeNull();
  });

  test('returns null when no file/test/error is mentioned', () => {
    expect(extractSubAgentSignal('I summarised the docs.')).toBeNull();
  });

  test('does not match unrelated paths like config.toml', () => {
    expect(extractSubAgentSignal('See README.md for details.')).toBeNull();
  });
});

describe('formatSubAgentSeed', () => {
  test('emits an XML-ish wrapper block', () => {
    const seed = formatSubAgentSeed({
      primarySourceFile: 'src/llm.ts',
      primaryTestFile: 'test/llm.test.ts',
      stackPreview: ['expected 4 but got 3'],
      interestingLine: 'expected 4 but got 3',
    });
    expect(seed.startsWith('<subagent-signal>')).toBe(true);
    expect(seed.endsWith('</subagent-signal>')).toBe(true);
    expect(seed).toContain('primarySourceFile: src/llm.ts');
    expect(seed).toContain('primaryTestFile: test/llm.test.ts');
    expect(seed).toContain('interestingLine: expected 4 but got 3');
    expect(seed).toContain('stackPreview:');
  });

  test('omits null fields cleanly', () => {
    const seed = formatSubAgentSeed({
      primarySourceFile: 'src/foo.ts',
      primaryTestFile: null,
      stackPreview: [],
      interestingLine: null,
    });
    expect(seed).toContain('primarySourceFile: src/foo.ts');
    expect(seed).not.toContain('primaryTestFile:');
    expect(seed).not.toContain('interestingLine:');
    expect(seed).not.toContain('stackPreview:');
  });
});

describe('enhanceAgentResultWithSeed', () => {
  test('appends a signal block when one is extractable', () => {
    const original = 'I traced the bug to src/llm.ts where expected 4 but got 3.';
    const out = enhanceAgentResultWithSeed(original);
    expect(out.startsWith(original)).toBe(true);
    expect(out).toContain('<subagent-signal>');
    expect(out).toContain('primarySourceFile: src/llm.ts');
  });

  test('passes through when no signal is extractable', () => {
    const original = 'The doc summary is …';
    expect(enhanceAgentResultWithSeed(original)).toBe(original);
  });

  test('separator is exactly one blank line when input has no trailing newline', () => {
    const out = enhanceAgentResultWithSeed('See src/foo.ts');
    expect(out).toContain('See src/foo.ts\n\n<subagent-signal>');
  });

  test('separator is just a newline when input already ends with one', () => {
    const out = enhanceAgentResultWithSeed('See src/foo.ts\n');
    expect(out).toContain('See src/foo.ts\n\n<subagent-signal>');
  });
});
