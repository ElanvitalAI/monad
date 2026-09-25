import { afterEach, describe, expect, test } from 'bun:test';

import { handleLogsQuery, parseLogQuery } from '../src/nexus/api/log-fabric.js';
import { LogStore } from '../src/mss/logging/log-store.js';
import type { LogRecord } from '../src/mss/logging/record.js';

const stores: LogStore[] = [];

function createStore(): LogStore {
  const store = new LogStore(':memory:', { instance: 'test:log-fabric' });
  stores.push(store);
  return store;
}

function insert(store: LogStore, category: string, event: string, data?: unknown): void {
  const rec: LogRecord = {
    ts: '2026-07-28T12:00:00.000Z',
    category,
    event,
    level: 'info',
    ...(data === undefined ? {} : { data }),
  };
  store.insertBatch([{ rec, surface: 'pwa' }]);
}

async function query(store: LogStore, search = ''): Promise<{ logs: Array<{ category: string; event: string }>; count: number }> {
  const response = handleLogsQuery(
    new Request(`http://localhost/v1/logs${search}`),
    { noAuth: true },
    { store: () => store },
  );
  expect(response.status).toBe(200);
  return await response.json() as { logs: Array<{ category: string; event: string }>; count: number };
}

function logPairs(body: { logs: Array<{ category: string; event: string }> }): Array<{ category: string; event: string }> {
  return body.logs.map(({ category, event }) => ({ category, event }));
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('log fabric exact filters', () => {
  test('event reaches the store and excludes a different event whose body contains it', async () => {
    const store = createStore();
    insert(store, 'terminal', 'lifecycle.bridge-attached');
    insert(store, 'terminal', 'headless.progress', { transcript: 'lifecycle.bridge-attached' });

    const body = await query(store, '?event=lifecycle.bridge-attached');

    expect(body.count).toBe(1);
    expect(logPairs(body)).toEqual([{ category: 'terminal', event: 'lifecycle.bridge-attached' }]);
  });

  test('exactCategory excludes children while category preserves prefix matching', async () => {
    const store = createStore();
    insert(store, 'signal', 'root');
    insert(store, 'signal.gate1', 'child');
    insert(store, 'other', 'unrelated');

    const exact = await query(store, '?exactCategory=signal');
    const prefix = await query(store, '?category=signal');

    expect(exact.count).toBe(1);
    expect(logPairs(exact)).toEqual([{ category: 'signal', event: 'root' }]);
    expect(prefix.count).toBe(2);
    expect(logPairs(prefix)).toEqual([
      { category: 'signal.gate1', event: 'child' },
      { category: 'signal', event: 'root' },
    ]);
  });

  test('empty exact filter lists are equivalent to omitting them', async () => {
    const store = createStore();
    insert(store, 'signal', 'root');
    insert(store, 'signal.gate1', 'child');

    const omitted = await query(store);
    const emptyEvent = await query(store, '?event=');
    const emptyCategory = await query(store, '?exactCategory=');

    expect({ logs: emptyEvent.logs, count: emptyEvent.count }).toEqual({ logs: omitted.logs, count: omitted.count });
    expect({ logs: emptyCategory.logs, count: emptyCategory.count }).toEqual({ logs: omitted.logs, count: omitted.count });
    expect(parseLogQuery(new URL('http://localhost/v1/logs?event=&exactCategory=')).query).toEqual({});
  });

  test('existing category and grep-only requests preserve prefix and body-or-event matching', async () => {
    const store = createStore();
    insert(store, 'voice', 'timeout');
    insert(store, 'voice.input', 'accepted', { text: 'timeout warning' });
    insert(store, 'voice.output', 'completed');
    insert(store, 'other', 'timeout');

    const body = await query(store, '?category=voice&grep=timeout');

    expect(body.count).toBe(2);
    expect(JSON.stringify(body.logs)).toBe('[{"id":2,"ts":"2026-07-28T12:00:00.000Z","level":"info","instance":"test:log-fabric","surface":"pwa","category":"voice.input","event":"accepted","data":{"text":"timeout warning"}},{"id":1,"ts":"2026-07-28T12:00:00.000Z","level":"info","instance":"test:log-fabric","surface":"pwa","category":"voice","event":"timeout"}]');
    expect(logPairs(body)).toEqual([
      { category: 'voice.input', event: 'accepted' },
      { category: 'voice', event: 'timeout' },
    ]);
  });
});
