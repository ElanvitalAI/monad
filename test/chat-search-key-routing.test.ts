import { describe, expect, test } from 'bun:test';
import { routeSearchModalKeyInput } from '../src/chat/search/key-routing.js';
import type { Key } from '../src/tui.js';

function key(name: string, extra: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...extra };
}

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    modal: {
      type(ch: string) { calls.push(`type:${ch}`); },
      backspace() { calls.push('backspace'); },
      up() { calls.push('up'); },
      down() { calls.push('down'); },
      accept() { calls.push('accept'); },
      cancel() { calls.push('cancel'); },
    },
  };
}

describe('routeSearchModalKeyInput', () => {
  test('routes navigation and submit keys', () => {
    const r = recorder();
    routeSearchModalKeyInput(key('down'), r.modal);
    routeSearchModalKeyInput(key('up'), r.modal);
    routeSearchModalKeyInput(key('enter'), r.modal);
    routeSearchModalKeyInput(key('escape'), r.modal);
    expect(r.calls).toEqual(['down', 'up', 'accept', 'cancel']);
  });

  test('routes typing, space, and backspace', () => {
    const r = recorder();
    routeSearchModalKeyInput(key('a'), r.modal);
    routeSearchModalKeyInput(key('space'), r.modal);
    routeSearchModalKeyInput(key('backspace'), r.modal);
    expect(r.calls).toEqual(['type:a', 'type: ', 'backspace']);
  });

  test('uses raw printable fallback when key name was normalized', () => {
    const r = recorder();
    routeSearchModalKeyInput(key('unknown', { raw: '한' }), r.modal);
    expect(r.calls).toEqual(['type:한']);
  });
});
