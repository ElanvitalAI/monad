import { afterEach, describe, expect, test } from 'bun:test';

import {
  createAddressBook,
  formatFullAddress,
  formatPaneAddress,
  formatWindowAddress,
  getGlobalAddressBook,
  mintPaneId,
  parseAddress,
  _resetGlobalAddressBookForTesting,
} from '../src/virtual-windows/addressing.js';

afterEach(() => _resetGlobalAddressBookForTesting());

describe('parseAddress', () => {
  test('win only', () => {
    expect(parseAddress('win:3')).toEqual({ raw: 'win:3', windowId: 3, paneId: undefined });
    expect(parseAddress('@win:7')).toEqual({ raw: '@win:7', windowId: 7, paneId: undefined });
  });
  test('pane only', () => {
    expect(parseAddress('pane:abc123')).toEqual({ raw: 'pane:abc123', paneId: 'abc123' });
  });
  test('fully qualified', () => {
    expect(parseAddress('win:2/pane:ff00aa')).toEqual({ raw: 'win:2/pane:ff00aa', windowId: 2, paneId: 'ff00aa' });
  });
  test('empty / garbage returns null', () => {
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('hello world')).toBeNull();
    expect(parseAddress('win:')).toBeNull();
    expect(parseAddress('pane:')).toBeNull();
  });
});

describe('format helpers', () => {
  test('window + pane + full', () => {
    expect(formatWindowAddress(5)).toBe('win:5');
    expect(formatPaneAddress('abc')).toBe('pane:abc');
    expect(formatFullAddress(1, 'xyz')).toBe('win:1/pane:xyz');
  });
});

describe('mintPaneId', () => {
  test('generates 6 hex chars', () => {
    const id = mintPaneId();
    expect(id).toMatch(/^[0-9a-f]{6}$/);
  });
  test('distinct on every call', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintPaneId()));
    // Not strictly 200 because of birthday-problem theory, but at
    // 200 from a 16M space the collision probability is vanishing.
    expect(ids.size).toBeGreaterThan(195);
  });
});

describe('createAddressBook', () => {
  test('register + resolve window by id', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w1' });
    expect(book.resolveWindow(1)?.title).toBe('w1');
    expect(book.resolveWindow('win:1')?.title).toBe('w1');
    expect(book.resolveWindow('@win:1')?.title).toBe('w1');
  });

  test('register + resolve pane', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w1' });
    book.registerPane({ id: 'abc', windowId: 1, kind: 'terminal' });
    expect(book.resolvePane('abc')?.kind).toBe('terminal');
    expect(book.resolvePane('pane:abc')?.kind).toBe('terminal');
    expect(book.resolvePane('@pane:abc')?.kind).toBe('terminal');
  });

  test('fully-qualified address resolves both', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 2, title: 'w2' });
    book.registerPane({ id: 'xyz', windowId: 2, kind: 'shell' });
    const got = book.parse('win:2/pane:xyz');
    expect(got.window?.id).toBe(2);
    expect(got.pane?.id).toBe('xyz');
  });

  test('unknown address → null', () => {
    const book = createAddressBook();
    expect(book.resolveWindow('win:99')).toBeNull();
    expect(book.resolvePane('pane:dead')).toBeNull();
  });

  test('unregisterWindow cascades panes', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 't' });
    book.registerPane({ id: 'b', windowId: 1, kind: 't' });
    book.unregisterWindow(1);
    expect(book.resolvePane('a')).toBeNull();
    expect(book.resolvePane('b')).toBeNull();
  });

  test('listPanes filters by windowId', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'a' });
    book.registerWindow({ id: 2, title: 'b' });
    book.registerPane({ id: 'p1', windowId: 1, kind: 't' });
    book.registerPane({ id: 'p2', windowId: 2, kind: 't' });
    expect(book.listPanes(1).map(p => p.id)).toEqual(['p1']);
    expect(book.listPanes(2).map(p => p.id)).toEqual(['p2']);
    expect(book.listPanes().length).toBe(2);
  });

  test('nextWindowId is sequential + respects existing', () => {
    const book = createAddressBook();
    expect(book.nextWindowId()).toBe(1);
    expect(book.nextWindowId()).toBe(2);
    book.registerWindow({ id: 10, title: 'x' });
    expect(book.nextWindowId()).toBe(11);
  });

  test('parse qualified with pane that also has windowId in pane entry', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 3, title: 'wX' });
    book.registerPane({ id: 'p3', windowId: 3, kind: 't' });
    // Resolve bare pane — should still work, window resolved via pane's windowId.
    const got = book.parse('pane:p3');
    expect(got.pane?.id).toBe('p3');
    expect(got.window?.id).toBe(3);
  });

  test('reset clears registry', () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'x' });
    book.reset();
    expect(book.listWindows()).toEqual([]);
  });
});

describe('getGlobalAddressBook', () => {
  test('returns the same instance until reset', () => {
    const a = getGlobalAddressBook();
    const b = getGlobalAddressBook();
    expect(a).toBe(b);
    _resetGlobalAddressBookForTesting();
    const c = getGlobalAddressBook();
    expect(c).not.toBe(a);
  });
});
