import { describe, expect, test } from 'bun:test';
import {
  applyEditsInMemory,
  computePatch,
  countPatchChanges,
  EditErrorCode,
} from '../../src/code-edit/index.js';

describe('applyEditsInMemory', () => {
  test('single unique edit succeeds', () => {
    const r = applyEditsInMemory('hello world', [
      { old_string: 'world', new_string: 'there' },
    ]);
    if (!('newContent' in r)) throw new Error('expected success');
    expect(r.newContent).toBe('hello there');
    expect(r.applied).toBe(1);
    expect(r.perEdit).toEqual([{ matches: 1, replaced: 1 }]);
  });

  test('batched edits apply in order', () => {
    const r = applyEditsInMemory('a b c', [
      { old_string: 'a', new_string: 'A' },
      { old_string: 'b', new_string: 'B' },
      { old_string: 'c', new_string: 'C' },
    ]);
    if (!('newContent' in r)) throw new Error('expected success');
    expect(r.newContent).toBe('A B C');
    expect(r.applied).toBe(3);
  });

  test('multiple matches without replace_all → EditError code 8', () => {
    const r = applyEditsInMemory('foo foo foo', [
      { old_string: 'foo', new_string: 'bar' },
    ]);
    if ('newContent' in r) throw new Error('expected error');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(EditErrorCode.MultipleMatches);
    expect(r.meta?.matchCount).toBe(3);
  });

  test('replace_all substitutes every occurrence', () => {
    const r = applyEditsInMemory('foo foo foo', [
      { old_string: 'foo', new_string: 'bar', replace_all: true },
    ]);
    if (!('newContent' in r)) throw new Error('expected success');
    expect(r.newContent).toBe('bar bar bar');
    expect(r.applied).toBe(3);
    expect(r.perEdit).toEqual([{ matches: 3, replaced: 3 }]);
  });

  test('missing old_string → EditError code 7', () => {
    const r = applyEditsInMemory('hello', [
      { old_string: 'zzz', new_string: 'x' },
    ]);
    if ('newContent' in r) throw new Error('expected error');
    expect(r.code).toBe(EditErrorCode.OldStringNotFound);
    expect(r.meta?.oldStringPreview).toBe('zzz');
  });

  test('old_string === new_string → EditError code 0 (NoChange)', () => {
    const r = applyEditsInMemory('hello', [
      { old_string: 'hello', new_string: 'hello' },
    ]);
    if ('newContent' in r) throw new Error('expected error');
    expect(r.code).toBe(EditErrorCode.NoChange);
    expect(r.meta?.editIndex).toBe(0);
  });

  test('empty edits array → ValidationError', () => {
    const r = applyEditsInMemory('hello', []);
    if ('newContent' in r) throw new Error('expected error');
    expect(r.code).toBe(EditErrorCode.ValidationError);
  });

  test('first failing edit stops the batch and reports its index', () => {
    const r = applyEditsInMemory('a b', [
      { old_string: 'a', new_string: 'A' },
      { old_string: 'missing', new_string: 'x' },
      { old_string: 'b', new_string: 'B' }, // would succeed, but we stopped
    ]);
    if ('newContent' in r) throw new Error('expected error');
    expect(r.code).toBe(EditErrorCode.OldStringNotFound);
    expect(r.meta?.editIndex).toBe(1);
  });

  test('replace_all with 1 match still succeeds', () => {
    const r = applyEditsInMemory('unique', [
      { old_string: 'unique', new_string: 'changed', replace_all: true },
    ]);
    if (!('newContent' in r)) throw new Error('expected success');
    expect(r.newContent).toBe('changed');
    expect(r.perEdit[0]).toEqual({ matches: 1, replaced: 1 });
  });

  test('preview truncates long old_string in error messages', () => {
    const longOld = 'x'.repeat(200);
    const r = applyEditsInMemory('nope', [
      { old_string: longOld, new_string: 'y' },
    ]);
    if ('newContent' in r) throw new Error('expected error');
    expect(String(r.meta?.oldStringPreview).length).toBeLessThanOrEqual(60);
  });
});

describe('computePatch + countPatchChanges', () => {
  test('no-op before/after produces zero hunks', () => {
    const hunks = computePatch('/f.ts', 'same\n', 'same\n');
    expect(hunks.length).toBe(0);
    expect(countPatchChanges(hunks)).toEqual({ added: 0, removed: 0 });
  });

  test('single-line change produces one hunk with one + and one -', () => {
    const before = 'line1\nline2\nline3\n';
    const after = 'line1\nline2-CHANGED\nline3\n';
    const hunks = computePatch('/f.ts', before, after);
    expect(hunks.length).toBe(1);
    const { added, removed } = countPatchChanges(hunks);
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });

  test('pure addition: removed=0, added>=N', () => {
    const before = 'a\n';
    const after = 'a\nb\nc\n';
    const { added, removed } = countPatchChanges(computePatch('/f.ts', before, after));
    expect(removed).toBe(0);
    expect(added).toBe(2);
  });

  test('pure deletion: added=0, removed>=N', () => {
    const before = 'a\nb\nc\n';
    const after = 'a\n';
    const { added, removed } = countPatchChanges(computePatch('/f.ts', before, after));
    expect(added).toBe(0);
    expect(removed).toBe(2);
  });

  test('hunks include oldStart / newStart line numbers', () => {
    const before = 'one\ntwo\nthree\nfour\n';
    const after = 'one\ntwo-EDITED\nthree\nfour\n';
    const hunks = computePatch('/f.ts', before, after);
    const h = hunks[0]!;
    expect(h.oldStart).toBeGreaterThan(0);
    expect(h.newStart).toBeGreaterThan(0);
    expect(h.lines.some((l) => l.startsWith('+'))).toBe(true);
    expect(h.lines.some((l) => l.startsWith('-'))).toBe(true);
  });
});
