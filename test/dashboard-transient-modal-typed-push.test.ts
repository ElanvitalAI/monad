// Phase B-3c pilot #4 — `showTransientTerminalModal` migrated from
// `coord.pushModal(surface)` onto
// `coord.modalLifecycleAPI().push('transient-term', {...}, surface)`.
//
// Fourth caller migrated off the legacy pushModal path. Exercises
// the pattern at a **different tier** (tooltip) and **different
// router model** (`activeByGroup` Map singleton-per-group vs the
// prior pilots' `approvalModalRouter`).

import { afterEach, describe, expect, test } from 'bun:test';
import {
  showTransientTerminalModal,
  _resetTransientTerminalModalsForTesting,
} from '../src/dashboard/modals/transient.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

afterEach(() => {
  _resetTransientTerminalModalsForTesting();
});

function makeCoordinator(): DisplayCoordinator {
  return new DisplayCoordinator({ frameMs: 0 });
}

describe('B-3c pilot #4 — transient-term typed primitive push', () => {
  test('typed handle appears in stackOrder with typeName "transient-term"', () => {
    const coord = makeCoordinator();

    const handle = showTransientTerminalModal({
      title: 'Snapshot',
      lines: ['alpha'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });

    const order = coord.modalLifecycleAPI().stackOrder();
    const typed = order.find((h) => h.typeName === 'transient-term');

    expect(typed).toBeDefined();
    expect(typed!.tier).toBe('tooltip');
    expect(typed!.key).toBe('transient-term:transient');
    expect(typed!.surface.id).toBe(handle.id);
    expect(typed!.isDisposed()).toBe(false);
  });

  test('idempotencyKey = group — replace semantics via primitive', () => {
    const coord = makeCoordinator();

    const first = showTransientTerminalModal({
      title: 'first',
      lines: ['a'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });
    const firstHandle = coord.modalLifecycleAPI()
      .stackOrder()
      .find((h) => h.typeName === 'transient-term');
    expect(firstHandle?.surface.id).toBe(first.id);

    // Second show in the same default group — primitive replace
    // policy disposes the prior handle; the caller-level
    // `activeByGroup.get(group)?.dispose()` sequence also runs
    // (idempotent via the shared disposed flag).
    const second = showTransientTerminalModal({
      title: 'second',
      lines: ['b'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });

    const live = coord.modalLifecycleAPI()
      .stackOrder()
      .filter((h) => !h.isDisposed() && h.typeName === 'transient-term');
    expect(live).toHaveLength(1);
    expect(live[0]!.surface.id).toBe(second.id);
  });

  test('distinct groups coexist — different idempotencyKeys', () => {
    const coord = makeCoordinator();

    showTransientTerminalModal({
      title: 'alpha', lines: ['a'],
      termCols: 100, termRows: 30, ttlMs: 0,
      coordinator: coord,
      group: 'alpha',
    });
    showTransientTerminalModal({
      title: 'beta', lines: ['b'],
      termCols: 100, termRows: 30, ttlMs: 0,
      coordinator: coord,
      group: 'beta',
    });

    const live = coord.modalLifecycleAPI()
      .stackOrder()
      .filter((h) => !h.isDisposed() && h.typeName === 'transient-term');
    expect(live).toHaveLength(2);
    const keys = new Set(live.map((h) => h.key));
    expect(keys.has('transient-term:alpha')).toBe(true);
    expect(keys.has('transient-term:beta')).toBe(true);
  });

  test('explicit dispose triggers coord.closeSurface (B-3b reverse-wiring)', () => {
    const coord = makeCoordinator();

    const handle = showTransientTerminalModal({
      title: 'to-close',
      lines: ['x'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });
    expect(coord.surface(handle.id)).not.toBeNull();

    handle.dispose();

    // B-3b Part 2: primitive disposed → coord closeSurface → surface
    // removed from coord.surfaces + focus manager unregistered.
    expect(coord.surface(handle.id)).toBeNull();
    expect(coord.focusManagerAPI().isRegistered(handle.id)).toBe(false);
    const live = coord.modalLifecycleAPI()
      .stackOrder()
      .filter((h) => !h.isDisposed() && h.typeName === 'transient-term');
    expect(live).toHaveLength(0);
  });

  test('onDispose callback fires after primitive dispose (lifecycle order)', () => {
    const coord = makeCoordinator();
    let onDisposeCalls = 0;

    const handle = showTransientTerminalModal({
      title: 'callback-test',
      lines: ['y'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
      onDispose: () => { onDisposeCalls++; },
    });

    handle.dispose();

    expect(onDisposeCalls).toBe(1);
    // Idempotent dispose — second call is no-op (shared `disposed` flag).
    handle.dispose();
    expect(onDisposeCalls).toBe(1);
  });
});
