// Ergonomic-port Tier E3.2 (2026-05-11) — matcher unit tests. The
// React lifecycle is a thin wrapper; the load-bearing surface is the
// pure matcher.

import { describe, expect, it } from 'bun:test';
import { matchesBinding, type ShortcutBinding } from './useKeyboardShortcuts';

const noop = (): void => {};

function ev(over: Partial<{
  key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean;
}> = {}): {
  key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean;
} {
  return { key: 'a', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over };
}

describe('matchesBinding', () => {
  it('matches a bare letter key', () => {
    const b: ShortcutBinding = { key: 'n', handler: noop };
    expect(matchesBinding(b, ev({ key: 'n' }))).toBe(true);
    expect(matchesBinding(b, ev({ key: 'N' }))).toBe(true); // case-insensitive
  });

  it('rejects when key differs', () => {
    const b: ShortcutBinding = { key: 'n', handler: noop };
    expect(matchesBinding(b, ev({ key: 'm' }))).toBe(false);
  });

  it('honors `metaOrCtrl` for cross-platform chord (Cmd or Ctrl + d)', () => {
    const b: ShortcutBinding = { key: 'd', metaOrCtrl: true, handler: noop };
    expect(matchesBinding(b, ev({ key: 'd', metaKey: true }))).toBe(true);
    expect(matchesBinding(b, ev({ key: 'd', ctrlKey: true }))).toBe(true);
    expect(matchesBinding(b, ev({ key: 'd' }))).toBe(false);
  });

  it('honors strict modifier requirements', () => {
    const b: ShortcutBinding = { key: 't', shift: true, alt: true, handler: noop };
    expect(matchesBinding(b, ev({ key: 't', shiftKey: true, altKey: true }))).toBe(true);
    expect(matchesBinding(b, ev({ key: 't', shiftKey: true }))).toBe(false);
    expect(matchesBinding(b, ev({ key: 't' }))).toBe(false);
  });

  it('matches a function key', () => {
    const b: ShortcutBinding = { key: 'F2', handler: noop };
    expect(matchesBinding(b, ev({ key: 'F2' }))).toBe(true);
    expect(matchesBinding(b, ev({ key: 'F3' }))).toBe(false);
  });

  it('treats unspecified modifier fields as wildcards', () => {
    // Only `key: 'n'` is required — Shift+n still matches.
    const b: ShortcutBinding = { key: 'n', handler: noop };
    expect(matchesBinding(b, ev({ key: 'n', shiftKey: true }))).toBe(true);
  });

  it('lets Cmd+\\ canvas-only chord pass when metaOrCtrl set', () => {
    const b: ShortcutBinding = { key: '\\', metaOrCtrl: true, handler: noop };
    expect(matchesBinding(b, ev({ key: '\\', metaKey: true }))).toBe(true);
    expect(matchesBinding(b, ev({ key: '\\' }))).toBe(false);
  });

  it('matches Enter with metaOrCtrl for "Run"', () => {
    const b: ShortcutBinding = { key: 'Enter', metaOrCtrl: true, handler: noop };
    expect(matchesBinding(b, ev({ key: 'Enter', ctrlKey: true }))).toBe(true);
    expect(matchesBinding(b, ev({ key: 'Enter' }))).toBe(false);
  });
});
