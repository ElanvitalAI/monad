// FU.B1 (2026-05-09 night) — keyboard shortcut matcher coverage.
//
// PWA bun test env has no `document` (use-live-camera convention),
// so editable-target tests use duck-typed stubs instead of real DOM.

import { describe, expect, test } from 'bun:test';
import {
  isShowroomShortcut,
  targetIsEditable,
  SHORTCUT_DESCRIPTIONS,
  type EditableTargetShape,
  type KeyEventLike,
} from './showroom-keyboard-shortcuts';

function ev(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; fromEditable?: boolean } = {},
): KeyEventLike {
  return {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    fromEditable: mods.fromEditable ?? false,
  };
}

function fakeTarget(tagName: string | null, contenteditable?: string): EditableTargetShape {
  const attrs = new Map<string, string>();
  if (contenteditable !== undefined) attrs.set('contenteditable', contenteditable);
  return {
    tagName,
    getAttribute: (name) => attrs.get(name) ?? null,
  };
}

describe('isShowroomShortcut · ⌘K focus-broadcast-input', () => {
  test('Cmd+K (Mac) → focus-broadcast-input', () => {
    expect(isShowroomShortcut(ev('k', { meta: true }))).toBe('focus-broadcast-input');
  });
  test('Ctrl+K (other) → focus-broadcast-input', () => {
    expect(isShowroomShortcut(ev('k', { ctrl: true }))).toBe('focus-broadcast-input');
  });
  test('K alone (no modifier) → null (don\'t hijack typing)', () => {
    expect(isShowroomShortcut(ev('k'))).toBe(null);
  });
  test('Cmd+Shift+K → null (different combo)', () => {
    expect(isShowroomShortcut(ev('k', { meta: true, shift: true }))).toBe(null);
  });
  test('Cmd+K from editable → still focus-broadcast-input (intentional)', () => {
    expect(isShowroomShortcut(ev('k', { meta: true, fromEditable: true })))
      .toBe('focus-broadcast-input');
  });
  test('uppercase K matches lowercase combo', () => {
    expect(isShowroomShortcut(ev('K', { meta: true }))).toBe('focus-broadcast-input');
  });
});

describe('isShowroomShortcut · ⌘⇧J toggle-role-judge', () => {
  test('Cmd+Shift+J → toggle-role-judge', () => {
    expect(isShowroomShortcut(ev('j', { meta: true, shift: true }))).toBe('toggle-role-judge');
  });
  test('Ctrl+Shift+J → toggle-role-judge', () => {
    expect(isShowroomShortcut(ev('j', { ctrl: true, shift: true }))).toBe('toggle-role-judge');
  });
  test('Cmd+J (no shift) → null', () => {
    expect(isShowroomShortcut(ev('j', { meta: true }))).toBe(null);
  });
  test('from editable → null (don\'t intercept typing)', () => {
    expect(isShowroomShortcut(ev('j', { meta: true, shift: true, fromEditable: true })))
      .toBe(null);
  });
});

describe('isShowroomShortcut · ⌘⇧M toggle-voice', () => {
  test('Cmd+Shift+M → toggle-voice', () => {
    expect(isShowroomShortcut(ev('m', { meta: true, shift: true }))).toBe('toggle-voice');
  });
  test('from editable → null', () => {
    expect(isShowroomShortcut(ev('m', { meta: true, shift: true, fromEditable: true })))
      .toBe(null);
  });
});

describe('isShowroomShortcut · ⌘⇧Y toggle-tts', () => {
  test('Cmd+Shift+Y → toggle-tts', () => {
    expect(isShowroomShortcut(ev('y', { meta: true, shift: true }))).toBe('toggle-tts');
  });
  test('from editable → null', () => {
    expect(isShowroomShortcut(ev('y', { meta: true, shift: true, fromEditable: true })))
      .toBe(null);
  });
});

describe('isShowroomShortcut · ? open-help (FU.B3)', () => {
  test('? alone → open-help (no modifier required)', () => {
    expect(isShowroomShortcut(ev('?'))).toBe('open-help');
  });
  test('? with Cmd → null (avoid Cmd+? collision)', () => {
    expect(isShowroomShortcut(ev('?', { meta: true }))).toBe(null);
  });
  test('? with Alt → null (avoid Mac symbol-input)', () => {
    expect(isShowroomShortcut(ev('?', { alt: true }))).toBe(null);
  });
  test('? from editable → null (typing the char)', () => {
    expect(isShowroomShortcut(ev('?', { fromEditable: true }))).toBe(null);
  });
  test('shift state is ignored (modern browsers send key="?" directly)', () => {
    // KeyEvent.key already accounts for shift+/, so we accept both
    // shift true and false.
    expect(isShowroomShortcut(ev('?', { shift: true }))).toBe('open-help');
    expect(isShowroomShortcut(ev('?', { shift: false }))).toBe('open-help');
  });
});

describe('isShowroomShortcut · misc safety', () => {
  test('plain text keys (no modifier) → null', () => {
    expect(isShowroomShortcut(ev('a'))).toBe(null);
    expect(isShowroomShortcut(ev('5'))).toBe(null);
    expect(isShowroomShortcut(ev('Enter'))).toBe(null);
    expect(isShowroomShortcut(ev('Tab'))).toBe(null);
  });
  test('Alt-modified shortcuts → null (avoid Mac symbol-input collision)', () => {
    expect(isShowroomShortcut(ev('k', { meta: true, alt: true }))).toBe(null);
    expect(isShowroomShortcut(ev('j', { meta: true, shift: true, alt: true }))).toBe(null);
  });
  test('common system combos pass through (Cmd+S, Cmd+R, Cmd+Z)', () => {
    expect(isShowroomShortcut(ev('s', { meta: true }))).toBe(null);
    expect(isShowroomShortcut(ev('r', { meta: true }))).toBe(null);
    expect(isShowroomShortcut(ev('z', { meta: true }))).toBe(null);
  });
});

describe('targetIsEditable', () => {
  test('null / undefined target → false', () => {
    expect(targetIsEditable(null)).toBe(false);
    expect(targetIsEditable(undefined)).toBe(false);
  });
  test('input → true', () => {
    expect(targetIsEditable(fakeTarget('INPUT'))).toBe(true);
  });
  test('textarea → true', () => {
    expect(targetIsEditable(fakeTarget('TEXTAREA'))).toBe(true);
  });
  test('select → true', () => {
    expect(targetIsEditable(fakeTarget('SELECT'))).toBe(true);
  });
  test('div → false', () => {
    expect(targetIsEditable(fakeTarget('DIV'))).toBe(false);
  });
  test('contenteditable="true" div → true', () => {
    expect(targetIsEditable(fakeTarget('DIV', 'true'))).toBe(true);
  });
  test('contenteditable="" div (HTML spec form) → true', () => {
    expect(targetIsEditable(fakeTarget('DIV', ''))).toBe(true);
  });
  test('contenteditable="false" div → false', () => {
    expect(targetIsEditable(fakeTarget('DIV', 'false'))).toBe(false);
  });
  test('null tagName → false', () => {
    expect(targetIsEditable(fakeTarget(null))).toBe(false);
  });
});

describe('SHORTCUT_DESCRIPTIONS catalog', () => {
  test('every shortcut id is described', () => {
    const ids = new Set(SHORTCUT_DESCRIPTIONS.map((s) => s.id));
    expect(ids).toEqual(new Set([
      'focus-broadcast-input',
      'toggle-role-judge',
      'toggle-voice',
      'toggle-tts',
      'open-help',
    ]));
  });
  test('each entry has combo + effect strings', () => {
    for (const entry of SHORTCUT_DESCRIPTIONS) {
      expect(entry.combo.length).toBeGreaterThan(0);
      expect(entry.effect.length).toBeGreaterThan(0);
    }
  });
  test('open-help entry combo = "?" (single-finger discovery)', () => {
    const entry = SHORTCUT_DESCRIPTIONS.find((s) => s.id === 'open-help');
    expect(entry?.combo).toBe('?');
  });
});
