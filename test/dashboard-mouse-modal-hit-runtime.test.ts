import { describe, expect, test } from 'bun:test';

import { createMouseModalHitRuntime } from '../src/dashboard/input/mouse-modal-hit-runtime.js';

describe('createMouseModalHitRuntime', () => {
  test('returns null when top surface is missing or non-modal', () => {
    const runtime = createMouseModalHitRuntime({
      getTopSurface: () => null,
    });
    expect(runtime.getModalHitTarget?.(5, 5)).toBeNull();

    const nonModal = createMouseModalHitRuntime({
      getTopSurface: () => ({ id: 'x', kind: 'pane' }),
    });
    expect(nonModal.getModalHitTarget?.(5, 5)).toBeNull();
  });

  test('uses interactive bounds when present', () => {
    const runtime = createMouseModalHitRuntime({
      getTopSurface: () => ({
        id: 'modal-1',
        kind: 'modal',
        bounds: { row: 1, col: 1, width: 10, height: 10 },
        interactiveBounds: { row: 4, col: 5, width: 3, height: 2 },
      }),
    });

    expect(runtime.getModalHitTarget?.(4, 5)).toEqual({
      kind: 'modal-body',
      modalId: 'modal-1',
    });
    expect(runtime.getModalHitTarget?.(2, 2)).toBeNull();
  });

  test('falls back to modal bounds when interactive bounds are absent', () => {
    const runtime = createMouseModalHitRuntime({
      getTopSurface: () => ({
        id: 'modal-2',
        kind: 'modal',
        bounds: { row: 10, col: 20, width: 4, height: 3 },
      }),
    });

    expect(runtime.getModalHitTarget?.(11, 21)).toEqual({
      kind: 'modal-body',
      modalId: 'modal-2',
    });
    expect(runtime.getModalHitTarget?.(13, 24)).toBeNull();
  });
});
