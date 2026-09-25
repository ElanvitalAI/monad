// ── Verification-nudge · unit tests ──
//
// ROADMAP-agent-surface-deferred-tools-2026-05-13 Wave 4 W4.3.
// Covers: completion counter accumulation, threshold-fire-once,
// review-by-status reset, review-by-note reset, threshold config,
// peek/reset for tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  configureVerificationNudge,
  foldVerificationNudge,
  peekVerificationNudge,
  resetVerificationNudge,
} from '../src/task-orchestrator/verification-nudge.ts';

beforeEach(() => { resetVerificationNudge(); });
afterEach(() => { resetVerificationNudge(); });

describe('verification-nudge', () => {
  test('initial peek is { consecutive: 0, threshold: 3 }', () => {
    expect(peekVerificationNudge()).toEqual({ consecutive: 0, threshold: 3 });
  });

  test('completion increments counter without firing below threshold', () => {
    const r1 = foldVerificationNudge({ nextStatus: 'completed' });
    expect(r1.consecutive).toBe(1);
    expect(r1.shouldNudge).toBe(false);
    const r2 = foldVerificationNudge({ nextStatus: 'completed' });
    expect(r2.consecutive).toBe(2);
    expect(r2.shouldNudge).toBe(false);
  });

  test('threshold-crossing completion fires nudge exactly once', () => {
    foldVerificationNudge({ nextStatus: 'completed' });
    foldVerificationNudge({ nextStatus: 'completed' });
    const fire = foldVerificationNudge({ nextStatus: 'completed' });
    expect(fire.consecutive).toBe(3);
    expect(fire.shouldNudge).toBe(true);
    expect(fire.nudgeMessage).toContain('<system-reminder>');
    expect(fire.nudgeMessage).toContain('3 tasks');

    // 4th completion: do NOT re-fire (counter advances but threshold-equal gate prevents).
    const noFire = foldVerificationNudge({ nextStatus: 'completed' });
    expect(noFire.consecutive).toBe(4);
    expect(noFire.shouldNudge).toBe(false);
    expect(noFire.nudgeMessage).toBe('');
  });

  test("status='review' resets the counter", () => {
    foldVerificationNudge({ nextStatus: 'completed' });
    foldVerificationNudge({ nextStatus: 'completed' });
    foldVerificationNudge({ nextStatus: 'review' });
    expect(peekVerificationNudge().consecutive).toBe(0);
    // After reset, threshold takes 3 more completions again.
    foldVerificationNudge({ nextStatus: 'completed' });
    foldVerificationNudge({ nextStatus: 'completed' });
    const fire = foldVerificationNudge({ nextStatus: 'completed' });
    expect(fire.shouldNudge).toBe(true);
  });

  test('failed / cancelled / superseded reset the counter', () => {
    for (const term of ['failed', 'cancelled', 'superseded'] as const) {
      foldVerificationNudge({ nextStatus: 'completed' });
      foldVerificationNudge({ nextStatus: 'completed' });
      foldVerificationNudge({ nextStatus: term });
      expect(peekVerificationNudge().consecutive).toBe(0);
    }
  });

  test('appendNote with review keyword resets the counter', () => {
    foldVerificationNudge({ nextStatus: 'completed' });
    foldVerificationNudge({ nextStatus: 'completed' });
    // The fold treats the note path AS a review/check signal, so even
    // a 'completed' update with a 'verified ...' note zeroes out.
    const reset = foldVerificationNudge({
      nextStatus: 'completed',
      note: 'verified: tests + manual smoke',
    });
    expect(reset.consecutive).toBe(0);
    expect(reset.shouldNudge).toBe(false);
  });

  test.each(['review', 'checked output', 'accept this', 'verification done'])(
    'note "%s" matches the review heuristic and resets',
    (note) => {
      foldVerificationNudge({ nextStatus: 'completed' });
      foldVerificationNudge({ nextStatus: 'completed' });
      const r = foldVerificationNudge({ nextStatus: 'completed', note });
      expect(r.consecutive).toBe(0);
    },
  );

  test('unrelated statuses (in_progress, ready, ...) do not move the counter', () => {
    foldVerificationNudge({ nextStatus: 'completed' });
    expect(peekVerificationNudge().consecutive).toBe(1);
    foldVerificationNudge({ nextStatus: 'in_progress' });
    expect(peekVerificationNudge().consecutive).toBe(1);
    foldVerificationNudge({ nextStatus: 'ready' });
    expect(peekVerificationNudge().consecutive).toBe(1);
  });

  test('configureVerificationNudge can lower the threshold for tests', () => {
    configureVerificationNudge({ threshold: 2 });
    foldVerificationNudge({ nextStatus: 'completed' });
    const fire = foldVerificationNudge({ nextStatus: 'completed' });
    expect(fire.consecutive).toBe(2);
    expect(fire.shouldNudge).toBe(true);
  });

  test('resetVerificationNudge restores default threshold + zero counter', () => {
    configureVerificationNudge({ threshold: 1 });
    foldVerificationNudge({ nextStatus: 'completed' }); // would fire
    resetVerificationNudge();
    expect(peekVerificationNudge()).toEqual({ consecutive: 0, threshold: 3 });
  });
});
