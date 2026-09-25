// ── OSC 8 hyperlink tests (Phase 4) ──

import { describe, test, expect } from 'bun:test';
import { osc8Link, osc8FileLink, stripOsc8 } from '../src/panes/osc8-hyperlink';

describe('osc8Link', () => {
  test('wraps text in OSC 8 open/close escapes', () => {
    const out = osc8Link('click', 'https://example.com');
    expect(out.startsWith('\x1b]8;;https://example.com\x1b\\')).toBe(true);
    expect(out).toContain('click');
    expect(out.endsWith('\x1b]8;;\x1b\\')).toBe(true);
  });

  test('id parameter is included in the open sequence', () => {
    const out = osc8Link('a', 'https://example.com', 'abc');
    expect(out).toContain('id=abc;https://example.com');
  });

  test('empty text → returned as-is (no link emitted)', () => {
    expect(osc8Link('', 'https://example.com')).toBe('');
  });

  test('empty uri → text returned unwrapped', () => {
    expect(osc8Link('text', '')).toBe('text');
  });
});

describe('osc8FileLink', () => {
  test('uses file:// URI', () => {
    const out = osc8FileLink('foo.ts', '/abs/foo.ts');
    expect(out).toContain('file:///abs/foo.ts');
  });
});

describe('stripOsc8', () => {
  test('removes open + close escape sequences', () => {
    const linked = osc8Link('click', 'https://example.com');
    expect(stripOsc8(linked)).toBe('click');
  });

  test('plain text passes through unchanged', () => {
    expect(stripOsc8('nothing to strip')).toBe('nothing to strip');
  });

  test('nested / concatenated links are all stripped', () => {
    const a = osc8Link('A', 'https://a.com');
    const b = osc8Link('B', 'https://b.com');
    expect(stripOsc8(a + ' ' + b)).toBe('A B');
  });
});
