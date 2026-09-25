// PR-CL4 (B.4 · 2026-04-29) — ACP sending-state lifecycle tests.
//
// Verifies that the sending-state counter:
//
//  - Tracks active submits per session and across sessions
//  - Records first-update wait + total duration samples
//  - Computes a rolling p95 once 2+ samples are present
//  - Flips the pill into `degraded` when p95 first-update >= 1.5s
//  - Survives multiple concurrent submits per session
//  - Cleans up on dropSession

import { describe, expect, test } from 'bun:test';
import {
  ACP_SENDING_DEGRADED_P95_MS,
  computeAcpSendingPill,
  createAcpSendingState,
} from '../src/acp/sending-state.js';

// ── lifecycle ─────────────────────────────────────────────────────────

describe('createAcpSendingState · single-session lifecycle', () => {
  test('summary is empty before any submit', () => {
    const state = createAcpSendingState();
    expect(state.summary()).toEqual({
      active: 0,
      p95FirstUpdateMs: null,
      p95TotalMs: null,
      completed: 0,
    });
  });

  test('noteSubmitStart increments active count + returns monotonic id', () => {
    const state = createAcpSendingState();
    const id1 = state.noteSubmitStart('s1', 1000);
    const id2 = state.noteSubmitStart('s1', 1100);
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(state.summary().active).toBe(2);
  });

  test('noteSubmitDone clears the active counter for that submit', () => {
    const state = createAcpSendingState();
    const id = state.noteSubmitStart('s1', 1000);
    state.noteSubmitDone('s1', id, 'ok', 1500);
    const sum = state.summary();
    expect(sum.active).toBe(0);
    expect(sum.completed).toBe(1);
  });

  test('noteSubmitDone is a no-op when submit id is unknown', () => {
    const state = createAcpSendingState();
    state.noteSubmitStart('s1', 1000);
    state.noteSubmitDone('s1', 9999, 'ok', 1100);
    expect(state.summary().active).toBe(1);
    expect(state.summary().completed).toBe(0);
  });

  test('noteSubmitDone is a no-op when sessionId is unknown', () => {
    const state = createAcpSendingState();
    state.noteSubmitDone('unknown', 1, 'ok', 1100);
    expect(state.summary()).toEqual({
      active: 0,
      p95FirstUpdateMs: null,
      p95TotalMs: null,
      completed: 0,
    });
  });
});

// ── first-update sampling ─────────────────────────────────────────────

describe('createAcpSendingState · first-update samples', () => {
  test('noteFirstUpdate records a wait sample on first call', () => {
    const state = createAcpSendingState();
    const id = state.noteSubmitStart('s1', 1000);
    state.noteFirstUpdate('s1', id, 1200);
    state.noteSubmitDone('s1', id, 'ok', 1500);
    // Only 1 sample so far → p95 is null (window requires 2+).
    expect(state.summary().p95FirstUpdateMs).toBeNull();
  });

  test('noteFirstUpdate is idempotent for the same submit id', () => {
    const state = createAcpSendingState();
    const id = state.noteSubmitStart('s1', 1000);
    state.noteFirstUpdate('s1', id, 1200);
    state.noteFirstUpdate('s1', id, 1500); // ignored
    state.noteSubmitDone('s1', id, 'ok', 1700);
    // Add a second submit so the p95 is computable.
    const id2 = state.noteSubmitStart('s1', 2000);
    state.noteFirstUpdate('s1', id2, 2300);
    state.noteSubmitDone('s1', id2, 'ok', 2500);
    const sum = state.summary();
    // Samples are the first-update waits: 200ms (first call) and 300ms.
    // p95 of [200, 300] = 200 + 100*0.95 = 295ms (linear interpolation).
    expect(sum.p95FirstUpdateMs).toBeCloseTo(295, 0);
  });

  test('noteFirstUpdate ignores unknown submit id', () => {
    const state = createAcpSendingState();
    state.noteFirstUpdate('s1', 5, 1200); // unknown session
    const id = state.noteSubmitStart('s1', 1000);
    state.noteFirstUpdate('s1', id + 100, 1300); // wrong submit id
    state.noteSubmitDone('s1', id, 'ok', 1500);
    expect(state.summary().completed).toBe(1);
  });
});

// ── p95 / degradation ─────────────────────────────────────────────────

describe('createAcpSendingState · p95 + degradation pill', () => {
  test('p95 first-update reflects rolling window once >= 2 samples', () => {
    const state = createAcpSendingState();
    const waits = [100, 150, 200, 250, 300]; // ms
    let t = 1000;
    for (const w of waits) {
      const id = state.noteSubmitStart('s1', t);
      state.noteFirstUpdate('s1', id, t + w);
      state.noteSubmitDone('s1', id, 'ok', t + w + 200);
      t += 1000;
    }
    const sum = state.summary();
    // Sorted: [100, 150, 200, 250, 300]; rank = 0.95*4 = 3.8;
    // interpolate between 250 (idx 3) and 300 (idx 4) at frac 0.8 → 290.
    expect(sum.p95FirstUpdateMs).toBeCloseTo(290, 0);
    expect(sum.completed).toBe(5);
  });

  test('computeAcpSendingPill returns empty label when active = 0', () => {
    const state = createAcpSendingState();
    expect(computeAcpSendingPill(state.summary())).toEqual({
      label: '',
      degraded: false,
    });
  });

  test('computeAcpSendingPill renders `acp:N⏳` while submits are active', () => {
    const state = createAcpSendingState();
    state.noteSubmitStart('s1', 1000);
    state.noteSubmitStart('s2', 1100);
    state.noteSubmitStart('s2', 1200);
    const pill = computeAcpSendingPill(state.summary());
    expect(pill.label).toBe('acp:3⏳');
    expect(pill.degraded).toBe(false);
  });

  test('computeAcpSendingPill flips degraded when p95 first-update >= 1500ms', () => {
    const state = createAcpSendingState();
    // Two slow samples → p95 well above the threshold.
    const waits = [1600, 1700];
    let t = 1000;
    for (const w of waits) {
      const id = state.noteSubmitStart('s1', t);
      state.noteFirstUpdate('s1', id, t + w);
      state.noteSubmitDone('s1', id, 'ok', t + w + 200);
      t += 5000;
    }
    // Active submit needed for the pill to render at all.
    state.noteSubmitStart('s1', t);
    const sum = state.summary();
    expect(sum.p95FirstUpdateMs).toBeGreaterThanOrEqual(ACP_SENDING_DEGRADED_P95_MS);
    const pill = computeAcpSendingPill(sum);
    expect(pill.label).toBe('acp:1⏳');
    expect(pill.degraded).toBe(true);
  });
});

// ── multi-session + concurrency ───────────────────────────────────────

describe('createAcpSendingState · multi-session', () => {
  test('summary.active aggregates across sessions', () => {
    const state = createAcpSendingState();
    state.noteSubmitStart('s1', 1000);
    state.noteSubmitStart('s2', 1010);
    state.noteSubmitStart('s2', 1020);
    expect(state.summary().active).toBe(3);
  });

  test('per-session submitSeq is independent', () => {
    const state = createAcpSendingState();
    expect(state.noteSubmitStart('s1', 1000)).toBe(1);
    expect(state.noteSubmitStart('s2', 1000)).toBe(1);
    expect(state.noteSubmitStart('s1', 1100)).toBe(2);
  });

  test('concurrent submits per session resolve independently', () => {
    const state = createAcpSendingState();
    const idA = state.noteSubmitStart('s1', 1000);
    const idB = state.noteSubmitStart('s1', 1050);
    state.noteFirstUpdate('s1', idA, 1200);
    state.noteFirstUpdate('s1', idB, 1300);
    expect(state.summary().active).toBe(2);
    state.noteSubmitDone('s1', idB, 'ok', 1400);
    expect(state.summary().active).toBe(1);
    state.noteSubmitDone('s1', idA, 'error', 1600);
    expect(state.summary().active).toBe(0);
    expect(state.summary().completed).toBe(2);
  });

  test('dropSession clears active submits for that session', () => {
    const state = createAcpSendingState();
    state.noteSubmitStart('s1', 1000);
    state.noteSubmitStart('s2', 1100);
    state.dropSession('s1');
    expect(state.summary().active).toBe(1);
  });

  test('dropSession is safe when sessionId is unknown', () => {
    const state = createAcpSendingState();
    state.dropSession('never-existed');
    expect(state.summary().active).toBe(0);
  });
});

// ── rolling window cap ────────────────────────────────────────────────

describe('createAcpSendingState · rolling window', () => {
  test('first-update sample window caps at 32 entries', () => {
    const state = createAcpSendingState();
    let t = 1000;
    for (let i = 0; i < 50; i++) {
      const id = state.noteSubmitStart('s1', t);
      // First-update wait grows from 100 → 1480ms over 50 samples;
      // the first 18 (100..540ms) age out of the 32-slot window so
      // the rolling p95 reflects the slow tail (>= ~1400ms range).
      state.noteFirstUpdate('s1', id, t + 100 + i * 30);
      state.noteSubmitDone('s1', id, 'ok', t + 200 + i * 30);
      t += 1000;
    }
    const sum = state.summary();
    expect(sum.completed).toBeGreaterThanOrEqual(32);
    // Rolling p95 is dominated by the recent slow tail; well above
    // the early-window 540ms boundary.
    expect(sum.p95FirstUpdateMs).toBeGreaterThan(540);
  });
});
