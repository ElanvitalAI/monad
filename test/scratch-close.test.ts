// ── Scratch close / Tab-skip tests (Phase S5) ──
// Mirror the dashboard's tabNext wrapper: nextPaneFocus → one extra
// hop when the cycle lands on 'scratch' while scratchClosed=true.

import { describe, test, expect } from 'bun:test';
import type { PaneFocus } from '../src/workspace-types.js';
import { nextPaneFocus } from '../src/working-dir/focus.js';

function tabNext(current: PaneFocus, view: 1 | 2 | 3 | 4, dir: 1 | -1, scratchClosed: boolean): PaneFocus {
  let next = nextPaneFocus(current, view, dir);
  if (view !== 4 && scratchClosed && next === 'scratch') {
    next = nextPaneFocus(next, view, dir);
  }
  return next;
}

describe('tabNext with scratchClosed=true', () => {
  test('V1 Normal is unchanged because scratch is not part of the cycle', () => {
    // V1 set: browser → preview → sessions-sidebar → log
    expect(tabNext('preview', 1, 1, true)).toBe('sessions-sidebar');
  });

  test('V1 Normal backward cycle is unchanged too', () => {
    expect(tabNext('log', 1, -1, true)).toBe('sessions-sidebar');
  });

  test('V2 Obsidian skips scratch inside the cycle', () => {
    // V2: browser → preview → obsidian → log → scratch → browser
    expect(tabNext('log', 2, 1, true)).toBe('browser');
    expect(tabNext('browser', 2, -1, true)).toBe('log');
  });

  test('V3 Skill skips scratch inside bottom row', () => {
    // V3: skill-browser → skill-file → preview → log → scratch → browser
    expect(tabNext('log', 3, 1, true)).toBe('browser');
    expect(tabNext('browser', 3, -1, true)).toBe('log');
  });

  test('V4 Scheduler falls back to the V1 browser cycle when scratchClosed=true', () => {
    expect(tabNext('log', 4, 1, true)).toBe('browser');
    expect(tabNext('scheduler-draft', 4, -1, true)).toBe('browser');
  });
});

describe('tabNext with scratchClosed=false (default behavior)', () => {
  test('V1 cycles through sessions sidebar normally', () => {
    expect(tabNext('preview', 1, 1, false)).toBe('sessions-sidebar');
  });
  test('V2 cycles through scratch normally', () => {
    expect(tabNext('log', 2, 1, false)).toBe('scratch');
  });
  test('V4 fallback remains the V1 browser cycle when scratch is open', () => {
    expect(tabNext('log', 4, 1, false)).toBe('browser');
    expect(tabNext('scheduler-draft', 4, -1, false)).toBe('browser');
  });
});
