import { afterEach, describe, expect, test } from 'bun:test';

import {
  showTransientTerminalModal,
  currentTransientTerminalModal,
  _resetTransientTerminalModalsForTesting,
  DEFAULT_TRANSIENT_TTL_MS,
} from '../src/dashboard/modals/transient.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

afterEach(() => {
  _resetTransientTerminalModalsForTesting();
});

function makeCoordinator(): DisplayCoordinator {
  return new DisplayCoordinator({ frameMs: 0 });
}

describe('showTransientTerminalModal', () => {
  test('registers a modal surface that paints with title + lines', () => {
    const coord = makeCoordinator();
    const handle = showTransientTerminalModal({
      title: 'Snapshot',
      lines: ['alpha', 'beta'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });
    expect(handle.id).toMatch(/^transient-term:/);
    const stack = coord.modalStack();
    expect(stack).toContain(handle.id);
    const surface = coord.surface(handle.id);
    expect(surface?.kind).toBe('modal');
  });

  test('TTL auto-dispose removes the surface', async () => {
    const coord = makeCoordinator();
    const pending: Array<{ fn: () => void; ms: number }> = [];
    const handle = showTransientTerminalModal({
      title: 'x',
      lines: ['a'],
      termCols: 100,
      termRows: 30,
      ttlMs: 50,
      coordinator: coord,
      schedule: (fn, ms) => { pending.push({ fn, ms }); return 0 as unknown as ReturnType<typeof setTimeout>; },
      clearSchedule: () => {},
    });
    expect(coord.modalStack()).toContain(handle.id);
    expect(pending[0]?.ms).toBe(50);
    pending[0]!.fn();   // trigger TTL
    expect(coord.modalStack()).not.toContain(handle.id);
  });

  test('explicit dispose removes the surface', () => {
    const coord = makeCoordinator();
    const handle = showTransientTerminalModal({
      title: 'x',
      lines: ['a'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });
    expect(coord.modalStack()).toContain(handle.id);
    handle.dispose();
    expect(coord.modalStack()).not.toContain(handle.id);
  });

  test('dispose is idempotent', () => {
    const coord = makeCoordinator();
    const handle = showTransientTerminalModal({
      title: 'x',
      lines: ['a'],
      termCols: 100,
      termRows: 30,
      ttlMs: 0,
      coordinator: coord,
    });
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  test('singleton replacement in the same group', () => {
    const coord = makeCoordinator();
    const first = showTransientTerminalModal({
      title: 'first', lines: ['a'], termCols: 100, termRows: 30, ttlMs: 0, coordinator: coord,
    });
    const second = showTransientTerminalModal({
      title: 'second', lines: ['b'], termCols: 100, termRows: 30, ttlMs: 0, coordinator: coord,
    });
    expect(coord.modalStack()).not.toContain(first.id);
    expect(coord.modalStack()).toContain(second.id);
    expect(currentTransientTerminalModal()?.id).toBe(second.id);
  });

  test('different groups coexist', () => {
    const coord = makeCoordinator();
    const a = showTransientTerminalModal({
      title: 'a', lines: [], termCols: 100, termRows: 30, ttlMs: 0, coordinator: coord, group: 'notify',
    });
    const b = showTransientTerminalModal({
      title: 'b', lines: [], termCols: 100, termRows: 30, ttlMs: 0, coordinator: coord, group: 'snapshot',
    });
    expect(coord.modalStack()).toContain(a.id);
    expect(coord.modalStack()).toContain(b.id);
  });

  test('bounds center within terminal at 70%', () => {
    const coord = makeCoordinator();
    const handle = showTransientTerminalModal({
      title: 'center', lines: [''], termCols: 100, termRows: 30, ttlMs: 0, coordinator: coord,
    });
    const w = handle.bounds.width;
    const h = handle.bounds.height;
    // 70% of 100 = 70
    expect(w).toBe(70);
    // height auto-shrinks to content (1 line + 2 borders = 3, but min=6)
    expect(h).toBe(6);
    // centered
    expect(handle.bounds.col).toBe(Math.floor((100 - 70) / 2) + 1);
  });

  test('paint output contains title + border glyphs', () => {
    const coord = makeCoordinator();
    const handle = showTransientTerminalModal({
      title: 'My Title', lines: ['hello'], termCols: 80, termRows: 24, ttlMs: 0, coordinator: coord,
    });
    const surface = coord.surface(handle.id)! as { paint: () => string };
    const ansi = surface.paint();
    // plain text stripped from the paint should contain the title.
    expect(ansi).toContain('My Title');
    expect(ansi).toContain('hello');
    // Corner glyphs for the border.
    expect(ansi).toContain('┌');
    expect(ansi).toContain('┘');
  });

  test('default TTL is 2500ms', () => {
    const coord = makeCoordinator();
    const pending: Array<number> = [];
    showTransientTerminalModal({
      title: 'x', lines: ['a'], termCols: 100, termRows: 30, coordinator: coord,
      schedule: (_fn, ms) => { pending.push(ms); return 0 as unknown as ReturnType<typeof setTimeout>; },
    });
    expect(pending[0]).toBe(DEFAULT_TRANSIENT_TTL_MS);
  });
});
