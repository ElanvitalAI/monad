import { describe, expect, test } from 'bun:test';
import type { SurfaceAddress } from '../src/surface/address.js';
import { isSurfaceKind, sameSurface, surfaceKey } from '../src/surface/address.js';

describe('F4-P1 — input SurfaceAddress kind', () => {
  test('surfaceKey round-trips input addresses', () => {
    const addr: SurfaceAddress = { kind: 'input', inputId: 'chat-main' };
    expect(surfaceKey(addr)).toBe('input::chat-main');
  });

  test('sameSurface distinguishes inputs by inputId', () => {
    const a: SurfaceAddress = { kind: 'input', inputId: 'chat-main' };
    const b: SurfaceAddress = { kind: 'input', inputId: 'chat-main' };
    const c: SurfaceAddress = { kind: 'input', inputId: 'modal:ask-user' };
    expect(sameSurface(a, b)).toBe(true);
    expect(sameSurface(a, c)).toBe(false);
  });

  test('sameSurface distinguishes input from other kinds', () => {
    const input: SurfaceAddress = { kind: 'input', inputId: 'foo' };
    const widget: SurfaceAddress = { kind: 'widget', widgetId: 'foo' };
    const modal: SurfaceAddress = { kind: 'modal', modalId: 'foo' };
    expect(sameSurface(input, widget)).toBe(false);
    expect(sameSurface(input, modal)).toBe(false);
  });

  test('isSurfaceKind recognizes "input"', () => {
    expect(isSurfaceKind('input')).toBe(true);
    expect(isSurfaceKind('pane')).toBe(true);
    expect(isSurfaceKind('nope')).toBe(false);
    expect(isSurfaceKind(42)).toBe(false);
    expect(isSurfaceKind(null)).toBe(false);
  });

  test('surfaceKey branches hit input arm without leaving other arms stale', () => {
    const cases: Array<{ addr: SurfaceAddress; key: string }> = [
      { addr: { kind: 'input', inputId: 'chat-main' }, key: 'input::chat-main' },
      { addr: { kind: 'input', inputId: 'modal:42' }, key: 'input::modal:42' },
      { addr: { kind: 'modal', modalId: 'chat-main' }, key: 'modal::chat-main' },
    ];
    for (const { addr, key } of cases) {
      expect(surfaceKey(addr)).toBe(key);
    }
  });
});
