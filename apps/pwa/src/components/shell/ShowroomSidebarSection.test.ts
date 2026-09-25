/** R6 Task 2 · §6.5 sidebar widget — pure helper coverage.
 *
 *  The component itself is React + Next router + DaemonContext heavy
 *  and exercised end-to-end by the showroom suite (which mounts the
 *  shell). Here we lock down the two pure helpers — `isLayoutActive`
 *  routing match and `formatRelativeSavedAt` — so future edits don't
 *  silently regress the active-highlight or the time format.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatRelativeSavedAt,
  isLayoutActive,
} from './ShowroomSidebarSection';

describe('ShowroomSidebarSection · isLayoutActive', () => {
  test('exact /showroom + matching ?show fires active', () => {
    expect(isLayoutActive('alpha', '/showroom', 'alpha')).toBe(true);
  });

  test('trailing slash on pathname is normalised', () => {
    expect(isLayoutActive('alpha', '/showroom/', 'alpha')).toBe(true);
  });

  test('different name → not active', () => {
    expect(isLayoutActive('alpha', '/showroom', 'beta')).toBe(false);
  });

  test('no ?show query → not active', () => {
    expect(isLayoutActive('alpha', '/showroom', null)).toBe(false);
  });

  test('different pathname → never active even with matching name', () => {
    expect(isLayoutActive('alpha', '/chat', 'alpha')).toBe(false);
    expect(isLayoutActive('alpha', '/workspace', 'alpha')).toBe(false);
  });

  test('null pathname → not active (SSR / pre-mount)', () => {
    expect(isLayoutActive('alpha', null, 'alpha')).toBe(false);
  });
});

describe('ShowroomSidebarSection · formatRelativeSavedAt', () => {
  const NOW = 1_700_000_000_000; // arbitrary fixed wall clock

  test('< 1 minute → "just now"', () => {
    expect(formatRelativeSavedAt(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelativeSavedAt(NOW, NOW)).toBe('just now');
  });

  test('1-59 minutes → "Nm ago"', () => {
    expect(formatRelativeSavedAt(NOW - 60_000, NOW)).toBe('1m ago');
    expect(formatRelativeSavedAt(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeSavedAt(NOW - 59 * 60_000, NOW)).toBe('59m ago');
  });

  test('1-23 hours → "Nh ago"', () => {
    expect(formatRelativeSavedAt(NOW - 60 * 60_000, NOW)).toBe('1h ago');
    expect(formatRelativeSavedAt(NOW - 6 * 60 * 60_000, NOW)).toBe('6h ago');
  });

  test('exactly 24h → yesterday', () => {
    expect(formatRelativeSavedAt(NOW - 24 * 60 * 60_000, NOW)).toBe('yesterday');
  });

  test('2-6 days → "Nd ago"', () => {
    expect(formatRelativeSavedAt(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe('2d ago');
    expect(formatRelativeSavedAt(NOW - 6 * 24 * 60 * 60_000, NOW)).toBe('6d ago');
  });

  test('≥ 7 days → "<Mon> <day>" short month + day', () => {
    const out = formatRelativeSavedAt(NOW - 30 * 24 * 60 * 60_000, NOW);
    // "Oct 18" / "Oct 19" depending on host TZ — assert the shape.
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  test('future timestamp clamps to "just now"', () => {
    expect(formatRelativeSavedAt(NOW + 60_000, NOW)).toBe('just now');
  });
});
