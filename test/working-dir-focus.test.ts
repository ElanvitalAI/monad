// ── Working-dir focus model tests ──
// Three-view system — V1 Normal / V2 Obsidian / V3 Skill.
// Surface-unification v2.2 V2.2-5 Part 2 (2026-05-11) — V4 (Scheduler)
// view retired (scheduler view 폐기 · V4 진입 시 V1 fallback pane set
// 반환).

import { describe, test, expect } from 'bun:test';
import {
  paneSetForView,
  firstPaneOfView,
  nextPaneFocus,
  repairFocus,
} from '../src/working-dir/focus.js';

describe('paneSetForView', () => {
  test('view 1 (Normal) = browser + preview + sessions-sidebar + log', () => {
    expect(paneSetForView(1)).toEqual(['browser', 'preview', 'sessions-sidebar', 'log']);
  });
  test('view 2 (Obsidian) = browser + preview + obsidian + log + scratch', () => {
    expect(paneSetForView(2)).toEqual(['browser', 'preview', 'obsidian', 'log', 'scratch']);
  });
  test('view 3 (Skill) = skill-browser + skill-file + preview + log + scratch + browser', () => {
    expect(paneSetForView(3)).toEqual([
      'skill-browser', 'skill-file', 'preview', 'log', 'scratch', 'browser',
    ]);
  });
  test('view 4 (retired Scheduler) falls back to view 1 pane set', () => {
    expect(paneSetForView(4)).toEqual(['browser', 'preview', 'sessions-sidebar', 'log']);
  });
  test('input is never part of a view pane set', () => {
    for (const v of [1, 2, 3, 4] as const) {
      expect(paneSetForView(v)).not.toContain('input');
    }
  });
});

describe('firstPaneOfView', () => {
  test('picks the first pane in tab order per view', () => {
    expect(firstPaneOfView(1)).toBe('browser');
    expect(firstPaneOfView(2)).toBe('browser');
    expect(firstPaneOfView(3)).toBe('skill-browser');
    // V4 retired → V1 fallback first pane.
    expect(firstPaneOfView(4)).toBe('browser');
  });
});

describe('nextPaneFocus', () => {
  test('Tab cycles forward inside V1 (Normal)', () => {
    expect(nextPaneFocus('browser', 1, 1)).toBe('preview');
    expect(nextPaneFocus('preview', 1, 1)).toBe('sessions-sidebar');
    expect(nextPaneFocus('sessions-sidebar', 1, 1)).toBe('log');
    expect(nextPaneFocus('log', 1, 1)).toBe('browser');     // wraps
  });

  test('Tab cycles forward inside V2 (Obsidian)', () => {
    expect(nextPaneFocus('browser', 2, 1)).toBe('preview');
    expect(nextPaneFocus('preview', 2, 1)).toBe('obsidian');
    expect(nextPaneFocus('obsidian', 2, 1)).toBe('log');
    expect(nextPaneFocus('log', 2, 1)).toBe('scratch');
    expect(nextPaneFocus('scratch', 2, 1)).toBe('browser'); // wraps
  });

  test('Tab cycles forward inside V3 (Skill)', () => {
    expect(nextPaneFocus('skill-browser', 3, 1)).toBe('skill-file');
    expect(nextPaneFocus('skill-file', 3, 1)).toBe('preview');
    expect(nextPaneFocus('preview', 3, 1)).toBe('log');
    expect(nextPaneFocus('log', 3, 1)).toBe('scratch');
    expect(nextPaneFocus('scratch', 3, 1)).toBe('browser');
    expect(nextPaneFocus('browser', 3, 1)).toBe('skill-browser'); // wraps
  });

  test('Shift+Tab cycles backward through V3 (Skill)', () => {
    expect(nextPaneFocus('skill-browser', 3, -1)).toBe('browser'); // wraps
    expect(nextPaneFocus('skill-file', 3, -1)).toBe('skill-browser');
    expect(nextPaneFocus('preview', 3, -1)).toBe('skill-file');
    expect(nextPaneFocus('log', 3, -1)).toBe('preview');
    expect(nextPaneFocus('scratch', 3, -1)).toBe('log');
    expect(nextPaneFocus('browser', 3, -1)).toBe('scratch');
  });

  test('falls back to the first pane when current is not in the set', () => {
    expect(nextPaneFocus('obsidian', 3, 1)).toBe('skill-browser');
    expect(nextPaneFocus('skill-file', 1, 1)).toBe('browser');
    // V4 retired → V1 fallback first pane.
    expect(nextPaneFocus('debug-events', 4, -1)).toBe('browser');
  });
});

describe('repairFocus', () => {
  test('keeps focus unchanged when it belongs to the view', () => {
    expect(repairFocus('preview', 1)).toBe('preview');
    expect(repairFocus('obsidian', 2)).toBe('obsidian');
    expect(repairFocus('skill-browser', 3)).toBe('skill-browser');
    // V4 retired → V1 fallback set covers `log` only (not the legacy
    // scheduler-* members).
    expect(repairFocus('log', 4)).toBe('log');
  });
  test('moves to first pane when focus is stranded', () => {
    expect(repairFocus('obsidian', 1)).toBe('browser');
    expect(repairFocus('skill-file', 2)).toBe('browser');
    // V4 retired → V1 fallback set; obsidian not in it → first pane.
    expect(repairFocus('obsidian', 4)).toBe('browser');
  });
  test('always preserves input focus regardless of view', () => {
    for (const v of [1, 2, 3, 4] as const) {
      expect(repairFocus('input', v)).toBe('input');
    }
  });
});
