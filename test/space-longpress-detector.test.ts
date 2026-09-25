// PR-S1V.D4 (sprint 21-Parallel-Voice · 2026-04-29) — Space long-press
// detector tests.
//
// Covers the timing-based hold/release reconstruction from the
// `>1u` keypress stream:
//   - tap (single press · gap before threshold) → onTap
//   - tap (explicit release · pending) → onTap
//   - long-press (press → repeats → gap after fire) → onLongPress + onLongRelease
//   - long-press (press → repeats → other key) → onLongPress + onLongRelease
//   - tap cancelled by other key before threshold → onTap

import { describe, expect, mock, test } from 'bun:test';
import {
  createSpaceLongPressDetector,
  isDictationHoldKey,
  isPlainSpaceHoldKey,
} from '../src/dashboard/input/space-longpress-detector.js';

interface FakeScheduler {
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  advance: (ms: number) => void;
  now: () => number;
}

function mkScheduler(): FakeScheduler {
  let now = 0;
  let seq = 0;
  const tasks = new Map<number, { at: number; cb: () => void }>();
  return {
    setTimer: (cb, ms) => {
      const id = ++seq;
      tasks.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimer: (h) => { tasks.delete(h as number); },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = [...tasks.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        due[1].cb();
      }
      now = target;
    },
    now: () => now,
  };
}

function mkCallbacks() {
  return {
    onLongPress: mock(() => {}),
    onLongRelease: mock(() => {}),
    onTap: mock(() => {}),
  };
}

// ── Tap scenarios ──────────────────────────────────────────────────

describe('PR-S1V.D4 · long-press detector · tap (under threshold)', () => {
  test('single press + gap inferred → onTap', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250,
      repeatGapMs: 80,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
      now: sched.now,
      ...cb,
    });
    d.noteSpaceKey();
    expect(d.getState()).toBe('pending');

    // 80ms gap with no follow-up → tap
    sched.advance(80);
    expect(cb.onTap).toHaveBeenCalledTimes(1);
    expect(cb.onLongPress).not.toHaveBeenCalled();
    expect(cb.onLongRelease).not.toHaveBeenCalled();
    expect(d.getState()).toBe('idle');
  });

  test('explicit release before threshold → onTap', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    d.noteSpaceKey();
    sched.advance(50);
    d.noteRelease();
    expect(cb.onTap).toHaveBeenCalledTimes(1);
    expect(cb.onLongPress).not.toHaveBeenCalled();
    expect(d.getState()).toBe('idle');
  });

  test('cancelled by other key before threshold → onTap', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    d.noteSpaceKey();
    sched.advance(100);
    d.noteOtherKey();
    expect(cb.onTap).toHaveBeenCalledTimes(1);
    expect(cb.onLongPress).not.toHaveBeenCalled();
  });
});

// ── Long-press scenarios ───────────────────────────────────────────

describe('PR-S1V.D4 · long-press detector · long-press (threshold reached)', () => {
  test('repeats sustain pending → threshold fires → gap inferred release', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    // First press
    d.noteSpaceKey();
    // Repeats every 30ms (faster than gap so detector never times out)
    for (let t = 30; t <= 240; t += 30) {
      sched.advance(30);
      d.noteSpaceKey();
      expect(d.getState()).toBe('pending');
    }
    // Now at 240ms · advance to 250 → threshold fires
    sched.advance(15); // 255ms
    expect(cb.onLongPress).toHaveBeenCalledTimes(1);
    expect(d.getState()).toBe('fired');

    // No more keystrokes → gap timer infers release at 255 + 80 = 335ms
    sched.advance(80);
    expect(cb.onLongRelease).toHaveBeenCalledTimes(1);
    expect(d.getState()).toBe('idle');
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  test('explicit release after fire → onLongRelease (kitty `>3u` path)', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    // Simulate OS key-repeat at 30ms intervals so the gap timer keeps
    // resetting and only the threshold timer fires.
    d.noteSpaceKey();
    for (let t = 30; t <= 240; t += 30) {
      sched.advance(30);
      d.noteSpaceKey();
    }
    sched.advance(15); // 255ms cumulative — threshold (250) fired
    expect(cb.onLongPress).toHaveBeenCalledTimes(1);
    expect(d.getState()).toBe('fired');

    // Host enabled `>3u` after fire — explicit release event arrives
    d.noteRelease();
    expect(cb.onLongRelease).toHaveBeenCalledTimes(1);
    expect(d.getState()).toBe('idle');
  });

  test('other key after fire → onLongRelease (cancel-by-other)', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    d.noteSpaceKey();
    for (let t = 30; t <= 240; t += 30) {
      sched.advance(30);
      d.noteSpaceKey();
    }
    sched.advance(15);
    expect(cb.onLongPress).toHaveBeenCalledTimes(1);
    d.noteOtherKey();
    expect(cb.onLongRelease).toHaveBeenCalledTimes(1);
    expect(cb.onTap).not.toHaveBeenCalled();
  });
});

// ── Edge cases ─────────────────────────────────────────────────────

describe('PR-S1V.D4 · long-press detector · edge cases', () => {
  test('release with no prior press → no-op', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    d.noteRelease();
    expect(cb.onTap).not.toHaveBeenCalled();
    expect(cb.onLongPress).not.toHaveBeenCalled();
    expect(cb.onLongRelease).not.toHaveBeenCalled();
  });

  test('dispose clears pending timers (no callbacks fire)', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    d.noteSpaceKey();
    d.dispose();
    sched.advance(500);
    expect(cb.onTap).not.toHaveBeenCalled();
    expect(cb.onLongPress).not.toHaveBeenCalled();
  });

  test('back-to-back tap then long-press — independent sequences', () => {
    const sched = mkScheduler();
    const cb = mkCallbacks();
    const d = createSpaceLongPressDetector({
      thresholdMs: 250, repeatGapMs: 80,
      setTimer: sched.setTimer, clearTimer: sched.clearTimer, now: sched.now,
      ...cb,
    });
    // 1) tap
    d.noteSpaceKey();
    sched.advance(80);
    expect(cb.onTap).toHaveBeenCalledTimes(1);

    // 2) long-press (OS repeats sustain pending past threshold)
    d.noteSpaceKey();
    for (let t = 30; t <= 240; t += 30) {
      sched.advance(30);
      d.noteSpaceKey();
    }
    sched.advance(15); // crosses threshold
    expect(cb.onLongPress).toHaveBeenCalledTimes(1);
    sched.advance(80); // gap inferred release
    expect(cb.onLongRelease).toHaveBeenCalledTimes(1);
  });
});

// ── isDictationHoldKey predicate · Gemini hybrid (Ctrl+Shift+Space OR D) ──

describe('PR-S1V.D5 · isDictationHoldKey · dual chord', () => {
  test('Ctrl+Shift+Space → true (canonical chord · D4-β)', () => {
    expect(isDictationHoldKey({ name: 'space', ctrl: true, shift: true })).toBe(true);
  });
  test('Ctrl+Shift+D → true (Ghostty fallback chord)', () => {
    expect(isDictationHoldKey({ name: 'd', ctrl: true, shift: true })).toBe(true);
    expect(isDictationHoldKey({ name: 'D', ctrl: true, shift: true })).toBe(true);
  });
  test('Ctrl+Shift+ㅇ → true (Korean IME · D position on 2-bul)', () => {
    expect(isDictationHoldKey({ name: 'ㅇ', ctrl: true, shift: true })).toBe(true);
  });
  test('plain Space / Ctrl+Space / Shift+Space → false', () => {
    expect(isDictationHoldKey({ name: 'space', ctrl: false, shift: false })).toBe(false);
    expect(isDictationHoldKey({ name: 'space', ctrl: true, shift: false })).toBe(false);
    expect(isDictationHoldKey({ name: 'space', ctrl: false, shift: true })).toBe(false);
  });
  test('plain D / Ctrl+D / Shift+D → false', () => {
    expect(isDictationHoldKey({ name: 'd', ctrl: false, shift: false })).toBe(false);
    expect(isDictationHoldKey({ name: 'd', ctrl: true, shift: false })).toBe(false);
    expect(isDictationHoldKey({ name: 'd', ctrl: false, shift: true })).toBe(false);
  });
  test('Ctrl+Shift+Alt+<chord> → false (alt reserved for window manager)', () => {
    expect(isDictationHoldKey({ name: 'space', ctrl: true, shift: true, alt: true })).toBe(false);
    expect(isDictationHoldKey({ name: 'd', ctrl: true, shift: true, alt: true })).toBe(false);
  });
  test('Ctrl+Shift+<other key> → false', () => {
    expect(isDictationHoldKey({ name: 'a', ctrl: true, shift: true })).toBe(false);
    expect(isDictationHoldKey({ name: 'enter', ctrl: true, shift: true })).toBe(false);
  });
  test('mouse event with matching mods → false', () => {
    expect(isDictationHoldKey({
      name: 'space', ctrl: true, shift: true, mouse: { row: 1, col: 1 },
    })).toBe(false);
    expect(isDictationHoldKey({
      name: 'd', ctrl: true, shift: true, mouse: { row: 1, col: 1 },
    })).toBe(false);
  });
});

// ── isPlainSpaceHoldKey predicate (D4-γ chord = plain Space outside chat-main) ──

describe('PR-S1V.D4-γ · isPlainSpaceHoldKey', () => {
  test('plain Space → true (outside-input dictation chord)', () => {
    expect(isPlainSpaceHoldKey({ name: 'space', ctrl: false, shift: false })).toBe(true);
  });
  test('Ctrl+Shift+Space → false (D4-β chord owned by isDictationHoldKey)', () => {
    expect(isPlainSpaceHoldKey({ name: 'space', ctrl: true, shift: true })).toBe(false);
  });
  test('any modifier on Space → false', () => {
    expect(isPlainSpaceHoldKey({ name: 'space', ctrl: true })).toBe(false);
    expect(isPlainSpaceHoldKey({ name: 'space', shift: true })).toBe(false);
    expect(isPlainSpaceHoldKey({ name: 'space', alt: true })).toBe(false);
  });
  test('non-space → false', () => {
    expect(isPlainSpaceHoldKey({ name: 'a' })).toBe(false);
    expect(isPlainSpaceHoldKey({ name: 'enter' })).toBe(false);
  });
  test('mouse event → false', () => {
    expect(isPlainSpaceHoldKey({ name: 'space', mouse: { row: 1, col: 1 } })).toBe(false);
  });
});
