// ── B-13-α — SurfaceAddress `window` kind · address-level tests ──
//
// Covers the union-level primitives added in this bundle:
//   * `surfaceKey({kind:'window', windowId})` → stable string key
//   * `isSurfaceKind('window')` narrows
//   * `sameSurface(a, b)` equality on windowId

import { describe, expect, test } from 'bun:test';

import {
  surfaceKey,
  isSurfaceKind,
  sameSurface,
  type SurfaceAddress,
} from '../src/surface/address.js';

describe('B-13-α · SurfaceAddress window kind', () => {
  test('surfaceKey produces stable window::<id> key', () => {
    const a: SurfaceAddress = { kind: 'window', windowId: 5 };
    expect(surfaceKey(a)).toBe('window::5');
  });

  test('isSurfaceKind narrows "window"', () => {
    expect(isSurfaceKind('window')).toBe(true);
    expect(isSurfaceKind('windows')).toBe(false);
    expect(isSurfaceKind(null)).toBe(false);
  });

  test('sameSurface equality matches windowId · mismatched windowIds differ', () => {
    const a: SurfaceAddress = { kind: 'window', windowId: 1 };
    const b: SurfaceAddress = { kind: 'window', windowId: 1 };
    const c: SurfaceAddress = { kind: 'window', windowId: 2 };
    expect(sameSurface(a, b)).toBe(true);
    expect(sameSurface(a, c)).toBe(false);
  });
});
