// Regression test for the slash/at/skill picker "infinite flicker"
// bug. Originally the picker's paint() function unconditionally
// rewrote surface.bounds + interactive/visual/backdrop — even when
// the computed rect was identical. The render coordinator interpreted
// the in-place mutation as a region change → invalidate → request
// frame → paint() runs again → ~48 Hz flicker.
//
// Fix history:
//   - 2026-05-03 (#1401-era): paint() short-circuited the rewrite
//     when numeric values were identical (no-op). Killed the flicker.
//   - 2026-05-03 Phase 4.5a: paint() no longer touches bounds AT ALL.
//     A new `getBounds(): ModalBounds | null` lifecycle hook (called
//     by coord BEFORE regionMap.resolve each frame) owns layout. This
//     test was updated to reflect the new contract.
//
// What this test pins:
//   - paint() never mutates surface.bounds (object identity always
//     preserved across paints, regardless of input changes).
//   - getBounds() reflects layout changes (returns a different rect
//     when item count changes) — coord then assigns.

import { describe, expect, test } from 'bun:test';

import type { SlashCommand } from '../src/chat/index.js';
import {
  chatPickerTestBounds,
  createChatPickerTestFamily,
  createChatPickerTestSources,
} from './helpers/chat-picker-family-fixture.js';

function makeSlashCommands(n: number): SlashCommand[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `cmd-${i}`,
    description: `Test command ${i}`,
  })) as SlashCommand[];
}

describe('chat picker surface bounds — no-op paint stability', () => {
  test('repeated paints with identical inputs preserve bounds object identity', () => {
    const family = createChatPickerTestFamily({
      bounds: { ...chatPickerTestBounds, row: 30 },
      sources: createChatPickerTestSources({
        slashItems: () => makeSlashCommands(5),
      }),
    });
    const surface = family.createSurface('slash');

    // First paint — establishes the initial bounds.
    surface.paint?.();
    const initialBounds = surface.bounds;
    const initialInteractive = surface.interactiveBounds;
    const initialVisual = surface.visualBounds;
    const initialBackdrop = surface.backdropBounds;

    expect(initialBounds).toBeTruthy();

    // Second paint — same inputs, MUST reuse the same object so the
    // render coordinator sees no region churn.
    surface.paint?.();
    expect(surface.bounds).toBe(initialBounds);
    expect(surface.interactiveBounds).toBe(initialInteractive);
    expect(surface.visualBounds).toBe(initialVisual);
    expect(surface.backdropBounds).toBe(initialBackdrop);

    // Third paint — same.
    surface.paint?.();
    expect(surface.bounds).toBe(initialBounds);
  });

  test('repeated paints over many frames stay stable (smoke for the 48 Hz feedback loop)', () => {
    const family = createChatPickerTestFamily({
      sources: createChatPickerTestSources({ slashItems: () => makeSlashCommands(8) }),
    });
    const surface = family.createSurface('slash');

    surface.paint?.();
    const baseline = surface.bounds;

    // Simulate 60 frames at "60 Hz" — same inputs throughout.
    for (let i = 0; i < 60; i++) {
      surface.paint?.();
    }

    // Object identity preserved across all 60 frames.
    expect(surface.bounds).toBe(baseline);
  });

  test('actual size change is reflected by getBounds() — paint() does NOT mutate bounds (Phase 4.5a contract)', () => {
    let itemCount = 5;
    const family = createChatPickerTestFamily({
      sources: createChatPickerTestSources({
        slashItems: () => makeSlashCommands(itemCount),
      }),
    });
    const surface = family.createSurface('slash');

    surface.paint?.();
    const initialBounds = surface.bounds;
    const initialHeight = initialBounds?.height ?? 0;
    expect(initialHeight).toBeGreaterThan(0);

    // Reduce items — getBounds() (the new lifecycle hook) returns a
    // different rect with smaller height. paint() does NOT mutate
    // surface.bounds — that's coord's job in production. For this
    // test we just verify getBounds reports the layout change.
    itemCount = 1;
    const desired = surface.getBounds?.();
    expect(desired).toBeTruthy();
    expect(desired!.height).toBeLessThan(initialHeight);

    // paint() called WITHOUT going through coord's settle path:
    // surface.bounds stays at its prior reference (paint never
    // touches bounds in Phase 4.5a). This is exactly §1.6 / §4-pre.7.
    surface.paint?.();
    expect(surface.bounds).toBe(initialBounds);

    // Painting again with the same item count is still no-op for bounds.
    surface.paint?.();
    expect(surface.bounds).toBe(initialBounds);
  });
});
