import { describe, expect, test } from 'bun:test';

import { selectNextFocusablePane } from '../../src/panes/pane-cycle.js';

const NEVER_SKIP = (): boolean => false;
const ALWAYS_SKIP = (): boolean => true;

describe('selectNextFocusablePane — trivial guards', () => {
  test('empty panes array → null', () => {
    expect(selectNextFocusablePane({
      panes: [], currentFocus: 'x', direction: 'forward', isSkipEligible: NEVER_SKIP,
    })).toBeNull();
  });

  test('single-pane window → null (nothing to cycle to)', () => {
    expect(selectNextFocusablePane({
      panes: ['a'], currentFocus: 'a', direction: 'forward', isSkipEligible: NEVER_SKIP,
    })).toBeNull();
  });

  test('currentFocus not in panes → null (pathological state)', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b'], currentFocus: 'ghost', direction: 'forward', isSkipEligible: NEVER_SKIP,
    })).toBeNull();
  });
});

describe('selectNextFocusablePane — 2-pane forward/backward wrap', () => {
  test('two panes · forward from 1st → 2nd', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b'], currentFocus: 'a', direction: 'forward', isSkipEligible: NEVER_SKIP,
    })).toBe('b');
  });

  test('two panes · forward from 2nd → wraps to 1st', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b'], currentFocus: 'b', direction: 'forward', isSkipEligible: NEVER_SKIP,
    })).toBe('a');
  });

  test('two panes · backward from 1st → wraps to 2nd', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b'], currentFocus: 'a', direction: 'backward', isSkipEligible: NEVER_SKIP,
    })).toBe('b');
  });

  test('two panes · backward from 2nd → 1st', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b'], currentFocus: 'b', direction: 'backward', isSkipEligible: NEVER_SKIP,
    })).toBe('a');
  });
});

describe('selectNextFocusablePane — skip semantics', () => {
  test('3 panes · middle skip · forward from 1st → 3rd', () => {
    const skip = new Set(['b']);
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c'], currentFocus: 'a', direction: 'forward',
      isSkipEligible: (id) => skip.has(id),
    })).toBe('c');
  });

  test('4 panes · alternating skip · forward walks through', () => {
    const skip = new Set(['b', 'd']);
    // a (focus) → skip b → c
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c', 'd'], currentFocus: 'a', direction: 'forward',
      isSkipEligible: (id) => skip.has(id),
    })).toBe('c');
    // c (focus) → skip d → wrap to a
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c', 'd'], currentFocus: 'c', direction: 'forward',
      isSkipEligible: (id) => skip.has(id),
    })).toBe('a');
  });

  test('4 panes · alternating skip · backward walks through', () => {
    const skip = new Set(['a', 'c']);
    // d (focus) ← skip c ← b
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c', 'd'], currentFocus: 'd', direction: 'backward',
      isSkipEligible: (id) => skip.has(id),
    })).toBe('b');
  });

  test('every other pane skip-eligible → null (no cycle target)', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c'], currentFocus: 'a', direction: 'forward',
      isSkipEligible: (id) => id !== 'a',
    })).toBeNull();
  });

  test('every pane (including current) skip-eligible → null', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c'], currentFocus: 'a', direction: 'forward',
      isSkipEligible: ALWAYS_SKIP,
    })).toBeNull();
  });
});

describe('selectNextFocusablePane — wrap arithmetic', () => {
  test('backward from 0th wraps to last', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c', 'd'], currentFocus: 'a', direction: 'backward',
      isSkipEligible: NEVER_SKIP,
    })).toBe('d');
  });

  test('forward from last wraps to 0th', () => {
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c', 'd'], currentFocus: 'd', direction: 'forward',
      isSkipEligible: NEVER_SKIP,
    })).toBe('a');
  });

  test('backward wrap · last→first skip · lands on last-focusable', () => {
    const skip = new Set(['a']);
    // b (focus) ← wrap to a (skip) ← d · note: when stepping backward
    // from b, we try a (skip), then d (ok). d is 3 steps backward.
    expect(selectNextFocusablePane({
      panes: ['a', 'b', 'c', 'd'], currentFocus: 'b', direction: 'backward',
      isSkipEligible: (id) => skip.has(id),
    })).toBe('d');
  });
});
