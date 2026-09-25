// FU.B1 (2026-05-09 night) — focus-trap module shape coverage.
//
// The full DOM lifecycle (mount → Tab cycle → focus restoration on
// unmount) is fundamentally `querySelectorAll` + `getComputedStyle`
// bound — the PWA bun test env (no `document`) can't host it. We
// follow the use-live-camera convention here: pin the export shape
// (cheap regression guard) and cover the lifecycle in dogfood
// (Showroom save modal · Tab cycles within · Escape closes · focus
// returns to the Save button on close).

import { describe, expect, test } from 'bun:test';
import { findFocusable, useFocusTrap } from './use-focus-trap';

describe('useFocusTrap module surface', () => {
  test('exports', () => {
    expect(typeof useFocusTrap).toBe('function');
    expect(typeof findFocusable).toBe('function');
  });
});
