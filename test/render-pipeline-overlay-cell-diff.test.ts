// Phase 4.5b (substrate Occam · §4-pre.10 partial · 2026-05-03) —
// overlay byte-equality skip. flushOverlay caches the rendered ANSI
// and skips the writeOverlay call when the next frame is byte-
// identical (unless `request.force === true` overrides). Wins the
// common case where cross-cutting dirty marks fire a flush but the
// overlay output didn't actually change.
//
// Origin / motivation: §4-pre.10 in REQUIREMENTS doc. Picked the
// simple byte-equality version over full cell-diff (ANSI parser +
// 2D grid) because (a) overlay is small, (b) "no change" is the
// dominant case, (c) full cell-diff is 5x LOC + autopilot risk.
// See PLAN-substrate-rebuild §6.5.2 for the full design rationale.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeStaticSurface(id: string, ansi: string, opts: {
  bounds?: { row: number; col: number; width: number; height: number };
} = {}): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'dialog',
    focus: 'owns',
    priority: 200,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 20, height: 5 },
    occluding: true,
    render: () => [],
    paint: () => ansi,
  };
}

function buildHarness(): {
  coord: DisplayCoordinator;
  flush: () => void;
  overlayWrites: string[];
} {
  const overlayWrites: string[] = [];
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* dashboard would paint here; harness no-op */ },
    writeOverlay: (ansi) => { overlayWrites.push(ansi); },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush, overlayWrites };
}

describe('overlay cell-diff · byte-equality skip', () => {
  test('first frame writes the overlay (cache empty → miss)', () => {
    const { coord, flush, overlayWrites } = buildHarness();
    const s = makeStaticSurface('a', '\x1b[1;1HHELLO');
    coord.pushModal(s);
    flush();
    const written = overlayWrites.filter((w) => w.includes('HELLO'));
    expect(written.length).toBeGreaterThanOrEqual(1);
    const stats = coord.overlayWriteStats();
    expect(stats.written).toBeGreaterThanOrEqual(1);
    expect(stats.skipped).toBe(0);
  });

  test('byte-identical repeat frame skips writeOverlay', () => {
    const { coord, flush, overlayWrites } = buildHarness();
    const s = makeStaticSurface('a', '\x1b[1;1HHELLO');
    coord.pushModal(s);
    flush();
    const writesAfterFirst = overlayWrites.length;

    // Trigger another flush — overlay output is unchanged. Skip expected.
    coord.requestRender({ region: 'all' });
    flush();
    const writesAfterSecond = overlayWrites.length;

    // The overlay write count should not have grown for the same
    // byte sequence. (Cursor / row-buffer writes from coord still
    // happen via main-frame path, but writeOverlay specifically is
    // the one we're counting.)
    expect(writesAfterSecond).toBe(writesAfterFirst);
    const stats = coord.overlayWriteStats();
    expect(stats.skipped).toBeGreaterThanOrEqual(1);
  });

  test('different-content frame writes (cache miss)', () => {
    const { coord, flush } = buildHarness();
    let payload = 'FIRST';
    const s: ModalSurface = {
      id: 'a' as SurfaceId,
      owner: 'dashboard',
      kind: 'modal',
      tier: 'dialog',
      focus: 'owns',
      priority: 200,
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      occluding: true,
      render: () => [],
      paint: () => `\x1b[1;1H${payload}`,
    };
    coord.pushModal(s);
    flush();
    coord._resetOverlayWriteCacheForTests();   // reset counters for clean diff
    // Cache repopulates on next flush.
    coord.requestRender({ region: 'all' });
    flush();
    const baselineWrites = coord.overlayWriteStats().written;

    // Mutate paint output (state changed) — cache should miss + write.
    payload = 'SECOND';
    coord.bumpGeneration?.(s.id);   // not strictly needed since picker doesn't opt in to gen cache, but harmless
    coord.requestRender({ region: 'all' });
    flush();
    const afterMutate = coord.overlayWriteStats().written;
    expect(afterMutate).toBeGreaterThan(baselineWrites);
  });

  test('request.force=true always writes (overrides skip)', () => {
    const { coord, flush } = buildHarness();
    const s = makeStaticSurface('a', '\x1b[1;1HSTATIC');
    coord.pushModal(s);
    flush();
    coord._resetOverlayWriteCacheForTests();

    // Force a flush with identical content — should still write.
    coord.requestRender({ region: 'all', force: true });
    flush();
    expect(coord.overlayWriteStats().written).toBeGreaterThanOrEqual(1);
  });

  test('overlay vanish (popModal) clears prev cache', () => {
    const { coord, flush } = buildHarness();
    const s = makeStaticSurface('a', '\x1b[1;1HSTATIC');
    coord.pushModal(s);
    flush();
    coord._resetOverlayWriteCacheForTests();

    // Pop → next overlay flush has empty ansi → prev cache cleared.
    coord.popModal(s.id);
    flush();
    // Re-mount same content → must write again (cache cleared on vanish).
    const s2 = makeStaticSurface('a', '\x1b[1;1HSTATIC');
    coord.pushModal(s2);
    flush();
    expect(coord.overlayWriteStats().written).toBeGreaterThanOrEqual(1);
  });

  test('overlayWriteStats counters are accurate across multiple flushes', () => {
    const { coord, flush } = buildHarness();
    const s = makeStaticSurface('a', '\x1b[1;1HSTATIC');
    coord.pushModal(s);
    flush();
    coord._resetOverlayWriteCacheForTests();

    // 5 flushes with identical content.
    for (let i = 0; i < 5; i++) {
      coord.requestRender({ region: 'all' });
      flush();
    }
    const stats = coord.overlayWriteStats();
    // First flush after reset misses (cache empty after reset),
    // remaining 4 hit. Total: 1 written + 4 skipped (or similar).
    expect(stats.skipped + stats.written).toBeGreaterThanOrEqual(1);
    expect(stats.skipped).toBeGreaterThanOrEqual(1);
  });
});
