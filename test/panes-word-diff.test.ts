// ── Inline word-diff tests (Phase 4) ──

import { describe, test, expect } from 'bun:test';
import { computeInlineWordDiff, hasIntraLineChange } from '../src/panes/word-diff';

describe('computeInlineWordDiff', () => {
  test('identical lines → all `same`, no change', () => {
    const d = computeInlineWordDiff('const x = 1;', 'const x = 1;');
    expect(d.oldParts.every((p) => p.kind === 'same')).toBe(true);
    expect(d.newParts.every((p) => p.kind === 'same')).toBe(true);
    expect(hasIntraLineChange(d)).toBe(false);
  });

  test('single-word substitution', () => {
    const d = computeInlineWordDiff('const x = 1;', 'const x = 2;');
    // `1` removed, `2` added. Other tokens remain `same`.
    expect(d.oldParts.some((p) => p.kind === 'del' && p.text.includes('1'))).toBe(true);
    expect(d.newParts.some((p) => p.kind === 'add' && p.text.includes('2'))).toBe(true);
    expect(hasIntraLineChange(d)).toBe(true);
  });

  test('rename with shared prefix/suffix', () => {
    const d = computeInlineWordDiff('foo(bar, baz)', 'foo(qux, baz)');
    // Expect `bar` → `qux`
    expect(d.oldParts.some((p) => p.kind === 'del' && p.text.includes('bar'))).toBe(true);
    expect(d.newParts.some((p) => p.kind === 'add' && p.text.includes('qux'))).toBe(true);
  });

  test('ignoreWhitespaceOnly suppresses pure-whitespace noise', () => {
    const d = computeInlineWordDiff('a b', 'a  b', { ignoreWhitespaceOnly: true });
    // With the option on, no intra-line change should register.
    expect(hasIntraLineChange(d)).toBe(false);
  });

  test('full line replacement — all content differs', () => {
    const d = computeInlineWordDiff('foo', 'bar');
    expect(hasIntraLineChange(d)).toBe(true);
  });
});

describe('hasIntraLineChange', () => {
  test('true when there is an add', () => {
    expect(hasIntraLineChange({
      oldParts: [{ kind: 'same', text: 'x' }],
      newParts: [{ kind: 'same', text: 'x' }, { kind: 'add', text: ' y' }],
    })).toBe(true);
  });

  test('true when there is a del', () => {
    expect(hasIntraLineChange({
      oldParts: [{ kind: 'del', text: 'gone' }],
      newParts: [{ kind: 'same', text: '' }],
    })).toBe(true);
  });

  test('false when everything is same', () => {
    expect(hasIntraLineChange({
      oldParts: [{ kind: 'same', text: 'x' }],
      newParts: [{ kind: 'same', text: 'x' }],
    })).toBe(false);
  });
});
