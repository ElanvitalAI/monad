// BACKLOG #2 — closest-match tool-name suggestion. Covers the
// helper directly + the call shape we actually wire into the
// `INVALID TOOL` stub at `src/llm.ts`.

import { describe, expect, test } from 'bun:test';
import { closestMatches, editDistance } from '../src/tool-name-suggest.js';

describe('editDistance', () => {
  test('identical strings → 0', () => {
    expect(editDistance('Read', 'Read')).toBe(0);
  });

  test('case-only difference → 0 (case-insensitive)', () => {
    expect(editDistance('read', 'Read')).toBe(0);
    expect(editDistance('READ', 'Read')).toBe(0);
  });

  test('single-char insert / delete / substitute → 1', () => {
    expect(editDistance('Edit', 'Edits')).toBe(1);
    expect(editDistance('Edits', 'Edit')).toBe(1);
    expect(editDistance('Edit', 'Edct')).toBe(1);
  });

  test('empty operand → length of the other', () => {
    expect(editDistance('', 'Read')).toBe(4);
    expect(editDistance('Read', '')).toBe(4);
    expect(editDistance('', '')).toBe(0);
  });

  test('typical typo → small distance', () => {
    expect(editDistance('EditFile', 'Edit')).toBe(4);
    expect(editDistance('Reed', 'Read')).toBe(1);
  });
});

describe('closestMatches', () => {
  const catalog = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'RunShell'];

  test('case-insensitive typo → top-1 is the right tool', () => {
    expect(closestMatches('Reed', catalog, 3)).toContain('Read');
    expect(closestMatches('Reed', catalog, 1)).toEqual(['Read']);
  });

  test('shape variant (EditFile → Edit) → top-1 = Edit', () => {
    const out = closestMatches('EditFile', catalog, 3);
    expect(out[0]).toBe('Edit');
  });

  test('totally unknown name with no near match → empty (over maxDistance)', () => {
    // `xyz123` is at least distance 5 from every entry in the catalog.
    expect(closestMatches('xyz123', catalog, 3)).toEqual([]);
  });

  test('exact match present → top-1 = the match (distance 0)', () => {
    expect(closestMatches('Bash', catalog, 3)[0]).toBe('Bash');
  });

  test('empty inputs → empty output', () => {
    expect(closestMatches('', catalog, 3)).toEqual([]);
    expect(closestMatches('Read', [], 3)).toEqual([]);
  });

  test('tie-breaker is alphabetic when distances are equal', () => {
    // From `Reab`: Read (1, substitute d) and Bash (3) and Grep (3) ...
    // Force a distance tie with `Tead`: distance 1 to Read; everything
    // else is ≥ 2. Synthesise a tie via two equally-distant entries.
    const tieCatalog = ['Bear', 'Beat']; // both distance 1 from `Bea` ?
    // distance('Bea','Bear')=1, distance('Bea','Beat')=1 → alphabetic
    // ordering picks Bear first.
    expect(closestMatches('Bea', tieCatalog, 2)).toEqual(['Bear', 'Beat']);
  });

  test('honours k limit', () => {
    // Every catalog entry is within maxDistance from `Real` for the
    // first few; assert we never exceed k.
    const out = closestMatches('Real', catalog, 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  test('respects custom maxDistance threshold', () => {
    expect(closestMatches('Real', catalog, 5, 0)).toEqual([]); // strict
    expect(closestMatches('Real', catalog, 5, 1)).toEqual(['Read']); // 1 sub
  });
});
