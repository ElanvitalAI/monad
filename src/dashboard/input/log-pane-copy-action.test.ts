import { describe, expect, test } from 'bun:test';

import { resolveLogPaneCopyAction } from './log-pane-copy-action.js';
import type { Key } from '../../tui.js';

function key(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

const portableActions = [
  { action: 'last-media', names: ['f', 'F', 'ㄹ'] },
  { action: 'last-code', names: ['y', 'Y', 'ㅛ'] },
  { action: 'last-message', names: ['g', 'G', 'ㅎ'] },
  { action: 'block', names: ['b', 'B', 'ㅠ'] },
  { action: 'all', names: ['a', 'A', 'ㅁ'] },
  { action: 'return-to-input', names: ['u', 'U', 'ㅕ'] },
] as const;

describe('resolveLogPaneCopyAction', () => {
  test('resolves every action and Korean alias through Alt prefixes whether Shift metadata is absent or present', () => {
    for (const { action, names } of portableActions) {
      for (const name of names) {
        expect(resolveLogPaneCopyAction(key(name, { alt: true }))).toBe(action);
        expect(resolveLogPaneCopyAction(key(name, { alt: true, shift: true }))).toBe(action);
      }
    }
  });

  test('rejects bare, Ctrl, Meta, and collision chords', () => {
    for (const name of portableActions.flatMap(({ names }) => names)) {
      expect(resolveLogPaneCopyAction(key(name))).toBeNull();
      expect(resolveLogPaneCopyAction(key(name, { ctrl: true }))).toBeNull();
      expect(resolveLogPaneCopyAction(key(name, { alt: true, ctrl: true }))).toBeNull();
      expect(resolveLogPaneCopyAction(key(name, { alt: true, meta: true }))).toBeNull();
    }

    // ⛔ 실제 점유자 — 덮으면 기능이 죽는다(2026-08-21 실측 · REFERENCE-alt-chord-map)
    for (const name of ['i', 'j', 'l', 't', 'z', 'm', 'o', 'p', 'n', 'w', 'c', 'r', 's', 'd', 'e']) {
      expect(resolveLogPaneCopyAction(key(name, { alt: true }))).toBeNull();
      expect(resolveLogPaneCopyAction(key(name, { alt: true, shift: true }))).toBeNull();
    }
  });
});
