import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInputHistoryStore, resetInputHistoryStoreForTests } from '../src/input-history.js';

describe('InputHistoryStore', () => {
  const roots: string[] = [];

  afterEach(() => {
    resetInputHistoryStoreForTests();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('records slash and chat inputs in sqlite', () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-input-history-'));
    roots.push(root);
    const store = openInputHistoryStore(join(root, 'history.sqlite'));

    const slash = store.record({ text: '/prompt config on', cwd: '/repo', activeView: 'debug', focusedPane: 'input' });
    const chat = store.record({ text: '  summarize this', cwd: '/repo' });

    expect(slash?.kind).toBe('slash');
    expect(chat?.kind).toBe('chat');
    expect(chat?.text).toBe('summarize this');
    expect(store.list(2).map(entry => entry.text)).toEqual(['summarize this', '/prompt config on']);
    store.close?.();
  });

  test('searches text and kind', () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-input-history-'));
    roots.push(root);
    const store = openInputHistoryStore(join(root, 'history.sqlite'));

    store.record({ text: '/history find revenue' });
    store.record({ text: 'find revenue insight' });
    store.record({ text: 'unrelated' });

    expect(store.search({ query: 'revenue' }).map(entry => entry.text)).toEqual([
      'find revenue insight',
      '/history find revenue',
    ]);
    expect(store.search({ query: 'revenue', kind: 'slash' }).map(entry => entry.text)).toEqual([
      '/history find revenue',
    ]);
    store.close?.();
  });

  test('json fallback stores and clears entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-input-history-json-'));
    roots.push(root);
    process.env.ELANOUS_INPUT_HISTORY_STORE = 'json';
    const store = openInputHistoryStore(join(root, 'ignored.sqlite'));
    delete process.env.ELANOUS_INPUT_HISTORY_STORE;

    store.record({ text: 'first' });
    store.record({ text: '/second' });
    expect(store.kind).toBe('json');
    expect(store.list(10).map(entry => entry.text)).toEqual(['/second', 'first']);
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
