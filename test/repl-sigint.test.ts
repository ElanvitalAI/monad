// BACKLOG #3 — REPL Ctrl-C double-tap decision. Covers the pure
// helper that the readline SIGINT listener delegates to.

import { describe, expect, test } from 'bun:test';
import { SIGINT_DOUBLE_TAP_MS, decideSigintAction } from '../src/repl/sigint.js';

describe('decideSigintAction', () => {
  test('first ever tap (lastSigintAt = 0) → hint', () => {
    expect(decideSigintAction(0, 1_000_000)).toBe('hint');
  });

  test('second tap within window → exit', () => {
    const t = 5_000_000;
    expect(decideSigintAction(t, t + 500)).toBe('exit');
    expect(decideSigintAction(t, t + 1_499)).toBe('exit');
  });

  test('second tap exactly at window boundary → hint (strict <)', () => {
    const t = 5_000_000;
    expect(decideSigintAction(t, t + SIGINT_DOUBLE_TAP_MS)).toBe('hint');
  });

  test('second tap past window → hint (cycle resets)', () => {
    const t = 5_000_000;
    expect(decideSigintAction(t, t + 5_000)).toBe('hint');
  });

  test('respects custom window argument', () => {
    const t = 5_000_000;
    // 1000ms window: 999 in → exit, 1000 out → hint.
    expect(decideSigintAction(t, t + 999, 1_000)).toBe('exit');
    expect(decideSigintAction(t, t + 1_000, 1_000)).toBe('hint');
  });

  test('SIGINT_DOUBLE_TAP_MS is the documented 1500ms', () => {
    // Pinned so docs and CLI hint stay aligned with the constant.
    expect(SIGINT_DOUBLE_TAP_MS).toBe(1500);
  });
});
