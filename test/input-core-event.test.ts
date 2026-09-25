import { describe, expect, test } from 'bun:test';
import { keyEvent, toMatcher, matcherCascade } from '../src/input-core/event.js';
import type { InputEvent, MouseInputEvent } from '../src/input-core/event.js';
import type { Key } from '../src/tui.js';

function k(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

describe('input-core event — toMatcher', () => {
  test('plain letter — no modifier decoration', () => {
    expect(toMatcher(keyEvent(k('a')))).toBe('a');
    expect(toMatcher(keyEvent(k('s')))).toBe('s');
  });

  test('plain letter with shift is NOT decorated (Key.shift only fires when terminal reports modifier)', () => {
    // shift+letter is conveyed as the uppercase byte OR as Key.shift=true.
    // We treat the short-form name (1 char) as pre-shifted and skip the
    // decoration, mirroring tmux/claude-code conventions.
    expect(toMatcher(keyEvent(k('a', { shift: true })))).toBe('a');
  });

  test('ctrl+letter', () => {
    expect(toMatcher(keyEvent(k('c', { ctrl: true })))).toBe('ctrl+c');
    expect(toMatcher(keyEvent(k('b', { ctrl: true })))).toBe('ctrl+b');
  });

  test('ctrl+shift+letter on named key — shift IS decorated when name > 1 char', () => {
    expect(toMatcher(keyEvent(k('tab', { ctrl: true, shift: true })))).toBe('ctrl+shift+tab');
  });

  test('named keys — escape / enter / tab / space / backspace', () => {
    expect(toMatcher(keyEvent(k('escape')))).toBe('escape');
    expect(toMatcher(keyEvent(k('enter')))).toBe('enter');
    expect(toMatcher(keyEvent(k('tab')))).toBe('tab');
    expect(toMatcher(keyEvent(k('space')))).toBe('space');
    expect(toMatcher(keyEvent(k('backspace')))).toBe('backspace');
  });

  test('raw control bytes canonicalize', () => {
    expect(toMatcher(keyEvent(k('\x1b')))).toBe('escape');
    expect(toMatcher(keyEvent(k('\r')))).toBe('enter');
    expect(toMatcher(keyEvent(k('\n')))).toBe('enter');
    expect(toMatcher(keyEvent(k('\t')))).toBe('tab');
    expect(toMatcher(keyEvent(k(' ')))).toBe('space');
  });

  test('mouse click on pill — specific matcher includes pill name', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 22, col: 40,
      target: { kind: 'pill', name: 'model' },
    };
    expect(toMatcher(ev)).toBe('click:pill.model');
  });

  test('mouse click on pane-title', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 4, col: 12,
      target: { kind: 'pane-title', paneId: 'browser' },
    };
    expect(toMatcher(ev)).toBe('click:pane-title.browser');
  });

  test('modifier+mouse', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 22, col: 40, shift: true,
      target: { kind: 'pill', name: 'model' },
    };
    expect(toMatcher(ev)).toBe('shift+click:pill.model');
  });

  test('scroll / drag / release', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'scroll-up', row: 10, col: 10,
      target: { kind: 'pane-body', paneId: 'log' },
    };
    expect(toMatcher(ev)).toBe('scroll-up:pane-body.log');
  });

  test('unknown target kind omits detail suffix', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 5, col: 5,
      target: { kind: 'unknown' },
    };
    expect(toMatcher(ev)).toBe('click:unknown');
  });
});

describe('input-core event — matcherCascade', () => {
  test('key event returns single matcher', () => {
    expect(matcherCascade(keyEvent(k('c', { ctrl: true })))).toEqual(['ctrl+c']);
  });

  test('mouse click on pill produces specific → generic', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 22, col: 40,
      target: { kind: 'pill', name: 'model' },
    };
    expect(matcherCascade(ev)).toEqual(['click:pill.model', 'click:pill']);
  });

  test('mouse event without detail collapses to one matcher', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 5, col: 5,
      target: { kind: 'status-bar' },
    };
    expect(matcherCascade(ev)).toEqual(['click:status-bar']);
  });

  test('modifier cascades consistently', () => {
    const ev: MouseInputEvent = {
      kind: 'mouse', type: 'click', row: 22, col: 40, shift: true,
      target: { kind: 'pane-title', paneId: 'browser' },
    };
    expect(matcherCascade(ev)).toEqual([
      'shift+click:pane-title.browser',
      'shift+click:pane-title',
    ]);
  });
});
