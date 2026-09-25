import { describe, expect, test } from 'bun:test';

import { resolveLogPaneCopyAction } from '../src/dashboard/input/log-pane-copy-action.js';
import type { Key } from '../src/tui.js';

function key(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

describe('resolveLogPaneCopyAction', () => {
  test('resolves the current Alt copy chords and Korean aliases', () => {
    expect(resolveLogPaneCopyAction(key('g', { alt: true }))).toBe('last-message');
    expect(resolveLogPaneCopyAction(key('ㅎ', { alt: true }))).toBe('last-message');
    expect(resolveLogPaneCopyAction(key('y', { alt: true }))).toBe('last-code');
    expect(resolveLogPaneCopyAction(key('ㅛ', { alt: true }))).toBe('last-code');
    expect(resolveLogPaneCopyAction(key('f', { alt: true }))).toBe('last-media');
    expect(resolveLogPaneCopyAction(key('ㄹ', { alt: true }))).toBe('last-media');
  });

  test('maps the current Alt block, all, and return-to-input chords', () => {
    expect(resolveLogPaneCopyAction(key('b', { alt: true }))).toBe('block');
    expect(resolveLogPaneCopyAction(key('ㅠ', { alt: true }))).toBe('block');
    expect(resolveLogPaneCopyAction(key('a', { alt: true }))).toBe('all');
    expect(resolveLogPaneCopyAction(key('ㅁ', { alt: true }))).toBe('all');
    expect(resolveLogPaneCopyAction(key('u', { alt: true }))).toBe('return-to-input');
    expect(resolveLogPaneCopyAction(key('ㅕ', { alt: true }))).toBe('return-to-input');
  });

  test('does not retain bare y/Y or accept modifier mismatches', () => {
    expect(resolveLogPaneCopyAction(key('y'))).toBeNull();
    expect(resolveLogPaneCopyAction(key('Y'))).toBeNull();
    expect(resolveLogPaneCopyAction(key('b', { ctrl: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('a', { ctrl: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('u', { ctrl: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('b', { ctrl: true, alt: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('a', { ctrl: true, shift: true, meta: true }))).toBeNull();
  });

  test('excludes terminal Ctrl+I/Ctrl+J aliases and occupied chords', () => {
    expect(resolveLogPaneCopyAction(key('i', { ctrl: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('j', { ctrl: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('l', { ctrl: true, shift: true }))).toBeNull();
    expect(resolveLogPaneCopyAction(key('t', { ctrl: true, shift: true }))).toBeNull();
  });
});
