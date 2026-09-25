// H6 P1 Bundle 1 · ConsecutiveFailureGate unit tests.
//
// Mirrors the behavior contract CodexBar's `UsageStoreSupport.swift`
// ships with: first failure swallowed when prior data existed; every
// other failure surfaces.

import { describe, test, expect } from 'bun:test';
import { ConsecutiveFailureGate } from '../../src/budget/failure-gate';

describe('ConsecutiveFailureGate', () => {
  test('first failure with prior data is swallowed', () => {
    const gate = new ConsecutiveFailureGate();
    expect(gate.shouldSurfaceError(true)).toBe(false);
    expect(gate.streak).toBe(1);
  });

  test('first failure without prior data surfaces immediately', () => {
    const gate = new ConsecutiveFailureGate();
    expect(gate.shouldSurfaceError(false)).toBe(true);
  });

  test('second consecutive failure always surfaces', () => {
    const gate = new ConsecutiveFailureGate();
    gate.shouldSurfaceError(true);
    expect(gate.shouldSurfaceError(true)).toBe(true);
    expect(gate.streak).toBe(2);
  });

  test('recordSuccess resets streak', () => {
    const gate = new ConsecutiveFailureGate();
    gate.shouldSurfaceError(true);
    gate.shouldSurfaceError(true);
    gate.recordSuccess();
    expect(gate.streak).toBe(0);
    expect(gate.shouldSurfaceError(true)).toBe(false);
  });

  test('reset without success also clears streak', () => {
    const gate = new ConsecutiveFailureGate();
    gate.shouldSurfaceError(true);
    gate.reset();
    expect(gate.streak).toBe(0);
  });
});
