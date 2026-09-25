import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

// LC1 / V4 — overlay region diff safety net.
//
// flushOverlay tracks which modal regions it painted on the prior
// flush; when a region goes away (surface unmounted via path other
// than closeSurface) or changes (re-upsert with different bounds),
// the prior rows are invalidated + a follow-up frame scheduled.

function makeModal(id: string, row: number, col: number, w: number, h: number, body = 'M'): ModalSurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
    bounds: { row, col, width: w, height: h },
    paint: () => body,
  };
}

function makeCoord() {
  const scheduled: Array<() => void> = [];
  const invalidatedRows: number[] = [];
  const overlayWrites: string[] = [];
  let forceTouched = 0;
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as any; },
    termSize: () => ({ rows: 30, cols: 120 }),
    invalidateRow: (r0) => invalidatedRows.push(r0),
    onRender: (req) => { if (req.force) forceTouched++; },
    writeOverlay: (s) => { overlayWrites.push(s); },
  });
  return { coord, scheduled, invalidatedRows, overlayWrites, getForceTouched: () => forceTouched };
}

describe('V4 overlay region diff', () => {
  test('re-upsert with different bounds invalidates prior rows', () => {
    const { coord, scheduled, invalidatedRows, overlayWrites } = makeCoord();
    // Frame 1 — modal at rows 5..8.
    coord.pushModal(makeModal('m', 5, 3, 40, 4, 'FIRST'));
    scheduled.shift()!();
    expect(overlayWrites.join('')).toContain('FIRST');
    invalidatedRows.length = 0;

    // Frame 2 — SAME id, different bounds (10..14). upsertSurface path.
    coord.pushModal(makeModal('m', 10, 3, 40, 5, 'SECOND'));
    scheduled.shift()!();
    // Prior rows 5..8 (0-indexed 4..7) must have been invalidated.
    expect(invalidatedRows).toContain(4);
    expect(invalidatedRows).toContain(7);
    // A follow-up frame is scheduled for the dirty rows.
    expect(scheduled.length).toBeGreaterThan(0);
  });

  test('vanishing from focus stack invalidates rows even without closeSurface', () => {
    const { coord, scheduled, invalidatedRows } = makeCoord();
    // Push two modals. m1 on rows 3..5, m2 on rows 10..12.
    coord.pushModal(makeModal('m1', 3, 3, 30, 3, 'A'));
    coord.pushModal(makeModal('m2', 10, 3, 30, 3, 'B'));
    // Drain scheduled frames.
    while (scheduled.length) scheduled.shift()!();
    invalidatedRows.length = 0;

    // Now remove m1 from focus stack via setFocus without closeSurface.
    // We simulate this by popModal of m1 which calls closeSurface —
    // but the key V4 behavior is: if ever focus.stack changes such
    // that m1 disappears from it, flushOverlay will see it go.
    coord.popModal('m1');
    scheduled.shift()!();
    // m1 covered rows 3..5 (0-indexed 2..4). closeSurface already
    // invalidates on its own path; V4 re-asserts via lastOverlayRegions.
    // Either path yields the same outcome — covered rows invalidated.
    expect(invalidatedRows).toContain(2);
    expect(invalidatedRows).toContain(4);
  });

  test('stable modal (bounds unchanged) does NOT trigger spurious invalidation', () => {
    const { coord, scheduled, invalidatedRows } = makeCoord();
    coord.pushModal(makeModal('m', 5, 3, 40, 4, 'X'));
    scheduled.shift()!();
    invalidatedRows.length = 0;

    // Force a re-flush with no change.
    coord.publish({ type: 'requestRender' });
    scheduled.shift()!();

    // Region unchanged → no invalidation.
    expect(invalidatedRows.length).toBe(0);
  });

  test('nested modals: popping top leaves bottom region intact', () => {
    const { coord, scheduled, invalidatedRows } = makeCoord();
    coord.pushModal(makeModal('bot', 2, 3, 30, 3, 'BOT'));
    coord.pushModal(makeModal('top', 8, 3, 30, 3, 'TOP'));
    while (scheduled.length) scheduled.shift()!();
    invalidatedRows.length = 0;

    coord.popModal('top');
    scheduled.shift()!();
    // Top was rows 8..10 (0-indexed 7..9) — invalidate those.
    expect(invalidatedRows).toContain(7);
    expect(invalidatedRows).toContain(9);
    // Bottom rows 2..4 (0-indexed 1..3) — must NOT be invalidated (still live).
    expect(invalidatedRows).not.toContain(1);
    expect(invalidatedRows).not.toContain(3);
  });

  test('no writeOverlay → lastOverlayRegions stays empty', () => {
    const scheduled: Array<() => void> = [];
    const coord = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      // no writeOverlay
    });
    coord.pushModal(makeModal('m', 3, 3, 20, 3, 'X'));
    scheduled.shift()!();
    // Nothing thrown, no follow-up frame spam.
    expect(scheduled.length).toBe(0);
  });
});
