import { describe, expect, test } from 'bun:test';

import type { SearchModalHandle } from '../src/chat/search/modal.js';
import { routeSearchModalKey } from '../src/dashboard/input/search-modal-router.js';
import type { Key } from '../src/tui.js';

function key(overrides: Partial<Key>): Key {
  return { name: '', ctrl: false, shift: false, ...overrides };
}

function modal() {
  const calls: string[] = [];
  const handle: SearchModalHandle = {
    surface: {
      id: 'test:search',
      owner: 'dashboard',
      kind: 'modal',
      focus: 'owns',
      priority: 200,
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      render: () => [],
    },
    type: (value) => { calls.push(`type:${value}`); },
    backspace: () => { calls.push('backspace'); },
    up: () => { calls.push('up'); },
    down: () => { calls.push('down'); },
    accept: () => { calls.push('accept'); },
    cancel: () => { calls.push('cancel'); },
    state: () => ({ query: '', items: [], selectedIdx: 0 }),
  };
  return { handle, calls };
}

describe('routeSearchModalKey', () => {
  test('routes lifecycle keys', () => {
    const t = modal();
    expect(routeSearchModalKey(key({ name: 'escape' }), t.handle)).toBe('consumed');
    routeSearchModalKey(key({ name: 'g', ctrl: true }), t.handle);
    routeSearchModalKey(key({ name: 'enter' }), t.handle);
    expect(t.calls).toEqual(['cancel', 'cancel', 'accept']);
  });

  test('routes navigation keys and Korean ctrl aliases', () => {
    const t = modal();
    routeSearchModalKey(key({ name: 'up' }), t.handle);
    routeSearchModalKey(key({ name: 'p', ctrl: true }), t.handle);
    routeSearchModalKey(key({ name: 'ㅔ', ctrl: true }), t.handle);
    routeSearchModalKey(key({ name: 'down' }), t.handle);
    routeSearchModalKey(key({ name: 'n', ctrl: true }), t.handle);
    routeSearchModalKey(key({ name: 'ㅜ', ctrl: true }), t.handle);
    expect(t.calls).toEqual(['up', 'up', 'up', 'down', 'down', 'down']);
  });

  test('routes editing and printable input', () => {
    const t = modal();
    routeSearchModalKey(key({ name: 'backspace' }), t.handle);
    routeSearchModalKey(key({ name: 'space' }), t.handle);
    routeSearchModalKey(key({ name: 'a' }), t.handle);
    routeSearchModalKey(key({ name: '한' }), t.handle);
    routeSearchModalKey(key({ name: 'exclamation', raw: '!' }), t.handle);
    expect(t.calls).toEqual(['backspace', 'type: ', 'type:a', 'type:한', 'type:!']);
  });

  test('swallows unsupported keys without mutating modal state', () => {
    const t = modal();
    routeSearchModalKey(key({ name: 'f1' }), t.handle);
    routeSearchModalKey(key({ name: 'a', ctrl: true }), t.handle);
    routeSearchModalKey(key({ name: 'paste-start', raw: '\x1b[200~' }), t.handle);
    expect(t.calls).toEqual([]);
  });
});
